// js/vision.js - RallyVision AI Shuttlecock Computer Vision & Trajectory Engine
// 3-Frame Temporal Differencing + High-Luminance Segmentation + Ballistic Kalman Trajectory Filter

export class ShuttlecockTrackerAI {
  constructor(courtManager, cameraManager, soundEngine) {
    this.court = courtManager;
    this.camera = cameraManager;
    this.sound = soundEngine;

    // Tracker state
    this.initialized = true;
    this.active = true;
    this.modelStatus = 'AI Vision Model Ready';
    this.confidence = 0; // 0..100%
    this.fps = 0;
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.fpsUpdateTimer = 0;

    // Analysis resolution for fast 60fps processing
    this.procW = 480;
    this.procH = 270;
    this.procCanvas = document.createElement('canvas');
    this.procCanvas.width = this.procW;
    this.procCanvas.height = this.procH;
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });

    // Frame history buffer for 3-frame differencing
    this.frameBuffer = []; // [ImageData_t-2, ImageData_t-1, ImageData_t]
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.procW;
    this.maskCanvas.height = this.procH;
    this.maskCtx = this.maskCanvas.getContext('2d');

    // Active shuttlecock track
    this.shuttle = null; // { x, y, vx, vy, normX, normY, speed, history: [{x, y, t}] }
    this.trajectory = []; // [{ normX, normY, speed, t }] past positions
    this.maxTrajectoryLength = 32;

    // Rally State Machine
    // 'IDLE' | 'IN_RALLY' | 'NET_FAULT' | 'FALL_DETECTED' | 'COOLDOWN'
    this.state = 'IDLE';
    this.rallyStartTime = 0;
    this.rallyShots = 0;
    this.lastCrossingSide = null;
    this.cooldownUntil = 0;

    // Landing / Fall visual ripple effect
    this.landingRipples = []; // [{ normX, normY, isIn, side, startTime, duration }]

    // Simulation engine for testing without physical shuttlecock
    this.simulating = false;
    this.simShuttle = null;

    // Callbacks
    this.onNetCrossing = null; // (data) => {}
    this.onNetFault = null;    // (data) => {}
    this.onShuttleLanded = null; // (data) => {}
    this.onStateChange = null;   // (state) => {}
  }

  reset() {
    this.shuttle = null;
    this.trajectory = [];
    this.state = 'IDLE';
    this.rallyShots = 0;
    this.lastCrossingSide = null;
    this.simulating = false;
    this.simShuttle = null;
  }

  // Main frame processing loop
  processFrame(videoOrSource) {
    const now = performance.now();
    this.frameCount++;
    if (now - this.fpsUpdateTimer > 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsUpdateTimer));
      this.frameCount = 0;
      this.fpsUpdateTimer = now;
    }

    // Handle simulation mode if active
    if (this.simulating && this.simShuttle) {
      this.updateSimulation(now);
      return;
    }

    if (!this.active || !videoOrSource) return;

    this.currentVideoTime = (videoOrSource && typeof videoOrSource.currentTime === 'number' && !isNaN(videoOrSource.currentTime))
      ? videoOrSource.currentTime
      : null;

    // 1. Draw source video into downscaled analysis canvas
    this.procCtx.drawImage(videoOrSource, 0, 0, this.procW, this.procH);

    let currentImgData;
    try {
      currentImgData = this.procCtx.getImageData(0, 0, this.procW, this.procH);
    } catch {
      return; // Security/CORS safeguard
    }

    // 2. Maintain 3-frame buffer
    this.frameBuffer.push(currentImgData);
    if (this.frameBuffer.length > 3) {
      this.frameBuffer.shift();
    }

    if (this.frameBuffer.length < 3) {
      return; // Need 3 consecutive frames for temporal differencing
    }

    // 3. Perform 3-Frame Temporal Differencing + Luminance / Color Thresholding
    const detection = this.detectShuttlecockInFrames(
      this.frameBuffer[0],
      this.frameBuffer[1],
      this.frameBuffer[2]
    );

    // 4. Update Trajectory & State Machine
    this.updateTracker(detection, now);
  }

  // 3-Frame Temporal Differencing + Color/Luminance segmentation
  detectShuttlecockInFrames(f0, f1, f2) {
    const d0 = f0.data;
    const d1 = f1.data;
    const d2 = f2.data;
    const totalPixels = this.procW * this.procH;

    const motionThresh = this.camera.filters.motionThreshold;
    const lumaThresh = this.camera.filters.lumaThreshold;
    const colorMode = this.camera.filters.shuttleColor;

    // Create mask image data for debug/mask view mode
    const maskData = this.maskCtx.createImageData(this.procW, this.procH);
    const mData = maskData.data;

    let candidatePixels = [];
    const minX = 0, maxX = this.procW;
    const minY = 0, maxY = this.procH;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;

      // Current frame RGB
      const r = d2[idx];
      const g = d2[idx + 1];
      const b = d2[idx + 2];

      // Luminance
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      // Temporal differences
      const diff1 = Math.abs(r - d1[idx]) + Math.abs(g - d1[idx + 1]) + Math.abs(b - d1[idx + 2]);
      const diff2 = Math.abs(d1[idx] - d0[idx]) + Math.abs(d1[idx + 1] - d0[idx + 1]) + Math.abs(d1[idx + 2] - d0[idx + 2]);

      // Both differences must show motion (temporal intersection eliminates background noise and ghosting)
      const hasMotion = diff1 > motionThresh && diff2 > (motionThresh * 0.7);

      let isColorMatch = false;
      if (colorMode === 'white') {
        isColorMatch = luma >= lumaThresh;
      } else if (colorMode === 'yellow') {
        // High Red and Green, low Blue
        isColorMatch = r > 160 && g > 150 && b < 130 && (r + g) > (2 * b + 50);
      } else if (colorMode === 'neon') {
        // High Green
        isColorMatch = g > 170 && (g > r + 30) && (g > b + 30);
      }

      if (hasMotion && isColorMatch) {
        const x = i % this.procW;
        const y = Math.floor(i / this.procW);
        candidatePixels.push({ x, y });

        // Highlight in debug mask
        mData[idx] = 199;     // Lime
        mData[idx + 1] = 255;
        mData[idx + 2] = 94;
        mData[idx + 3] = 255;
      } else {
        mData[idx + 3] = 0; // Transparent
      }
    }

    this.maskCtx.putImageData(maskData, 0, 0);

    // 5. Cluster candidate pixels into connected blobs
    if (candidatePixels.length < 3) return null;

    const blobs = clusterPixelsIntoBlobs(candidatePixels, 20);
    const minSize = this.camera.filters.minSize;
    const maxSize = this.camera.filters.maxSize;

    // Filter blobs by size and aspect ratio
    const validBlobs = blobs.filter(b => {
      const w = b.maxX - b.minX + 1;
      const h = b.maxY - b.minY + 1;
      const area = b.pixels.length;
      const aspect = w / Math.max(1, h);
      return area >= minSize && area <= (maxSize * maxSize) && aspect >= 0.3 && aspect <= 3.2;
    });

    if (!validBlobs.length) return null;

    // Pick best blob matching kinematics or closest to predicted position
    let bestBlob = validBlobs[0];
    if (this.shuttle) {
      const predX = (this.shuttle.normX + this.shuttle.vx) * this.procW;
      const predY = (this.shuttle.normY + this.shuttle.vy) * this.procH;
      let minScore = Infinity;
      for (const b of validBlobs) {
        const dist = Math.hypot(b.cx - predX, b.cy - predY);
        if (dist < minScore) {
          minScore = dist;
          bestBlob = b;
        }
      }
    } else {
      // Pick highest density blob
      validBlobs.sort((a, b) => b.pixels.length - a.pixels.length);
      bestBlob = validBlobs[0];
    }

    return {
      normX: bestBlob.cx / this.procW,
      normY: bestBlob.cy / this.procH,
      width: (bestBlob.maxX - bestBlob.minX + 1) / this.procW,
      height: (bestBlob.maxY - bestBlob.minY + 1) / this.procH,
      area: bestBlob.pixels.length
    };
  }

  // Update Trajectory and State Machine
  updateTracker(detection, now) {
    if (now < this.cooldownUntil) {
      // In cooldown period following a point (allows players to pick up shuttle)
      this.shuttle = null;
      return;
    }

    if (detection) {
      const normX = detection.normX;
      const normY = detection.normY;

      if (!this.shuttle) {
        // Initialize new shuttlecock track
        this.shuttle = {
          normX,
          normY,
          vx: 0,
          vy: 0,
          speed: 0,
          lastSeen: now,
          activeFrames: 1
        };
        this.trajectory = [{ normX, normY, speed: 0, t: now }];
        this.confidence = 40;
      } else {
        // Update kinematic velocity
        const dt = Math.max(16, now - this.shuttle.lastSeen) / 1000;
        const dx = normX - this.shuttle.normX;
        const dy = normY - this.shuttle.normY;

        // Velocity in normalized units/sec
        this.shuttle.vx = dx / dt;
        this.shuttle.vy = dy / dt;

        // Speed in px/s & estimated km/h (based on 13.4m court length)
        const speedNorm = Math.hypot(this.shuttle.vx, this.shuttle.vy);
        const estSpeedKmh = Math.round(speedNorm * (this.court.courtLength / 0.7) * 3.6);
        this.shuttle.speed = estSpeedKmh;

        const prevX = this.shuttle.normX;
        const prevY = this.shuttle.normY;

        this.shuttle.normX = normX;
        this.shuttle.normY = normY;
        this.shuttle.lastSeen = now;
        this.shuttle.activeFrames++;

        this.confidence = Math.min(100, this.confidence + 12);

        // Add to trajectory history
        this.trajectory.push({ normX, normY, speed: estSpeedKmh, t: now });
        if (this.trajectory.length > this.maxTrajectoryLength) {
          this.trajectory.shift();
        }

        // --- CHECK 1: NET CROSSING DETECTION ---
        const crossCheck = this.court.checkNetCrossing(
          { x: prevX, y: prevY },
          { x: normX, y: normY }
        );

        if (crossCheck.crossed) {
          if (crossCheck.isAboveNet) {
            // Valid Net Crossing above the tape!
            this.rallyShots++;
            this.lastCrossingSide = crossCheck.fromSide;
            this.sound.playNetCrossingPing();

            if (this.onNetCrossing) {
              this.onNetCrossing({
                fromSide: crossCheck.fromSide,
                toSide: crossCheck.toSide,
                speed: estSpeedKmh,
                shots: this.rallyShots,
                clearance: crossCheck.clearance
              });
            }
          }
        }

        // --- CHECK 2: NET FAULT DETECTION (ON OR UNDER NET) ---
        const faultCheck = this.court.checkNetFault(normX, normY, prevX, prevY);
        if (faultCheck.isFault) {
          this.triggerNetFault(faultCheck.reason, { x: normX, y: normY });
          return;
        }

        // --- CHECK 3: STATE TRANSITION TO IN_RALLY ---
        if (this.shuttle.activeFrames >= 3 && this.state === 'IDLE') {
          this.state = 'IN_RALLY';
          this.rallyStartTime = now;
          if (this.onStateChange) this.onStateChange('IN_RALLY');
        }

        // --- CHECK 4: FALL / LANDING DETECTION ---
        // A fall occurs when downward movement terminates, or velocity drops to zero near court ground
        const isNearCourtFloor = normY > Math.min(this.court.corners[0].y, this.court.corners[1].y) - 0.15;
        const speedDropped = speedNorm < 0.12 && this.shuttle.activeFrames >= 5;

        if (this.state === 'IN_RALLY' && isNearCourtFloor && (speedDropped || this.shuttle.vy > 0.4)) {
          // Check if it hit the floor
          if (normY >= this.court.corners[0].y * 0.85 || speedDropped) {
            this.triggerShuttleFall(normX, normY, now);
            return;
          }
        }
      }
    } else {
      // No detection in this frame
      if (this.shuttle) {
        const timeSinceSeen = now - this.shuttle.lastSeen;

        // If lost during a downward rally trajectory near court, treat as landing!
        if (this.state === 'IN_RALLY' && timeSinceSeen > 180 && this.shuttle.normY > 0.6) {
          this.triggerShuttleFall(this.shuttle.normX, this.shuttle.normY, now);
          return;
        }

        if (timeSinceSeen > 400) {
          // Track lost
          this.shuttle = null;
          this.confidence = Math.max(0, this.confidence - 20);
          if (this.state === 'IN_RALLY') {
            this.state = 'IDLE';
            if (this.onStateChange) this.onStateChange('IDLE');
          }
        }
      } else {
        this.confidence = Math.max(0, this.confidence - 5);
      }
    }
  }

  // Trigger Net Fault (alarm on net or under it)
  triggerNetFault(reason, pos) {
    this.state = 'NET_FAULT';
    this.sound.playNetFaultAlarm(1200);
    this.court.triggerAlarmFlash();

    const faultSide = this.court.getSideOfNet(pos.x, pos.y);

    if (this.onNetFault) {
      this.onNetFault({
        reason: reason, // 'ON_NET' or 'UNDER_NET'
        side: faultSide,
        position: pos,
        videoTime: this.currentVideoTime
      });
    }

    if (this.onStateChange) this.onStateChange('NET_FAULT');

    // Add ripple effect
    this.addLandingRipple(pos.x, pos.y, false, faultSide);

    // Enter cooldown to reset
    this.cooldownUntil = performance.now() + 2500;
    this.shuttle = null;
  }

  // Trigger Fall / Landing on court
  triggerShuttleFall(normX, normY, now) {
    this.state = 'FALL_DETECTED';

    const isInPlayable = this.court.isInsidePlayableSpace(normX, normY);
    const side = this.court.getSideOfNet(normX, normY); // 'A' or 'B'
    const durationSec = Math.max(1, (now - (this.rallyStartTime || now)) / 1000);

    // Sound effect
    this.sound.playFallChime(isInPlayable);

    // Visual ripple effect on landing coordinates
    this.addLandingRipple(normX, normY, isInPlayable, side);

    if (this.onShuttleLanded) {
      this.onShuttleLanded({
        side: side,
        isIn: isInPlayable,
        position: { x: normX, y: normY },
        speed: this.shuttle?.speed || 0,
        rallyShots: this.rallyShots,
        duration: durationSec.toFixed(1),
        videoTime: this.currentVideoTime
      });
    }

    if (this.onStateChange) this.onStateChange('FALL_DETECTED');

    // Cooldown window (e.g. 2.8 seconds) to prevent double counts
    this.cooldownUntil = now + 2800;
    this.shuttle = null;
    this.rallyShots = 0;
  }

  addLandingRipple(normX, normY, isIn, side) {
    this.landingRipples.push({
      normX,
      normY,
      isIn,
      side,
      startTime: performance.now(),
      duration: 1500
    });
  }

  // Built-in Interactive Rally Simulator
  simulateRally(scenario = 'clean_rally') {
    this.simulating = true;
    this.state = 'IN_RALLY';
    this.rallyStartTime = performance.now();
    this.rallyShots = 0;
    this.trajectory = [];

    // Flight paths for different test scenarios
    // clean_rally: side A -> net crossing -> side B in-bounds landing
    // net_fault: side A -> hits net cord
    // under_net: side A -> passes under net
    // out_of_bounds: side B -> falls outside court
    let path = [];

    if (scenario === 'clean_rally') {
      path = [
        { x: 0.35, y: 0.82, vx: 0.05, vy: -0.85 },
        { x: 0.38, y: 0.65, vx: 0.08, vy: -0.60 },
        { x: 0.44, y: 0.42, vx: 0.12, vy: -0.25 }, // Net crossing near y=0.50
        { x: 0.52, y: 0.36, vx: 0.14, vy: 0.15 },  // Peak
        { x: 0.60, y: 0.40, vx: 0.12, vy: 0.45 },
        { x: 0.68, y: 0.55, vx: 0.08, vy: 0.70 },
        { x: 0.72, y: 0.72, vx: 0.04, vy: 0.85 }  // Landing Side B (IN)
      ];
    } else if (scenario === 'net_fault') {
      path = [
        { x: 0.35, y: 0.82, vx: 0.10, vy: -0.65 },
        { x: 0.42, y: 0.66, vx: 0.12, vy: -0.40 },
        { x: 0.50, y: 0.52, vx: 0.05, vy: 0.10 }  // Hits net cord
      ];
    } else if (scenario === 'under_net') {
      path = [
        { x: 0.32, y: 0.75, vx: 0.12, vy: -0.20 },
        { x: 0.42, y: 0.65, vx: 0.14, vy: -0.05 },
        { x: 0.52, y: 0.60, vx: 0.14, vy: 0.15 }  // Under net (between bot and top)
      ];
    } else { // out_of_bounds
      path = [
        { x: 0.45, y: 0.78, vx: 0.25, vy: -0.75 },
        { x: 0.60, y: 0.45, vx: 0.30, vy: -0.15 },
        { x: 0.78, y: 0.32, vx: 0.35, vy: 0.30 },
        { x: 0.94, y: 0.40, vx: 0.30, vy: 0.80 }  // Falls outside right boundary (OUT)
      ];
    }

    this.simShuttle = {
      path: path,
      currentIndex: 0,
      currentX: path[0].x,
      currentY: path[0].y,
      lastStep: performance.now(),
      scenario: scenario
    };
  }

  updateSimulation(now) {
    if (!this.simShuttle) return;

    const s = this.simShuttle;
    const dt = (now - s.lastStep) / 1000;

    if (dt >= 0.09) { // ~11 updates per second for smooth visible trajectory
      s.lastStep = now;
      s.currentIndex++;

      if (s.currentIndex < s.path.length) {
        const pt = s.path[s.currentIndex];
        const prevPt = s.path[s.currentIndex - 1];

        s.currentX = pt.x;
        s.currentY = pt.y;

        const estSpeedKmh = Math.round(Math.hypot(pt.vx, pt.vy) * 220);

        this.shuttle = {
          normX: pt.x,
          normY: pt.y,
          vx: pt.vx,
          vy: pt.vy,
          speed: estSpeedKmh,
          lastSeen: now,
          activeFrames: s.currentIndex + 1
        };

        this.trajectory.push({ normX: pt.x, normY: pt.y, speed: estSpeedKmh, t: now });
        if (this.trajectory.length > this.maxTrajectoryLength) this.trajectory.shift();

        // Check net crossing
        const cross = this.court.checkNetCrossing(
          { x: prevPt.x, y: prevPt.y },
          { x: pt.x, y: pt.y }
        );
        if (cross.crossed && cross.isAboveNet) {
          this.rallyShots++;
          this.sound.playNetCrossingPing();
          if (this.onNetCrossing) {
            this.onNetCrossing({
              fromSide: cross.fromSide,
              toSide: cross.toSide,
              speed: estSpeedKmh,
              shots: this.rallyShots
            });
          }
        }

        // Check net fault
        const fault = this.court.checkNetFault(pt.x, pt.y, prevPt.x, prevPt.y);
        if (fault.isFault || s.scenario === 'net_fault' && s.currentIndex === s.path.length - 1) {
          this.triggerNetFault(fault.reason || 'ON_NET', { x: pt.x, y: pt.y });
          this.simulating = false;
          this.simShuttle = null;
          return;
        }
      } else {
        // Sim reached final landing point
        const lastPt = s.path[s.path.length - 1];
        this.triggerShuttleFall(lastPt.x, lastPt.y, now);
        this.simulating = false;
        this.simShuttle = null;
      }
    }
  }

  // Render Visual HUD & AI Tracking Reticle on canvas
  render(ctx, width, height, dpr = 1) {
    const toScreen = (normX, normY) => ({ x: normX * width, y: normY * height });
    const now = performance.now();

    // 1. Draw Trajectory Comet Trail
    if (this.trajectory.length > 1) {
      ctx.save();
      for (let i = 1; i < this.trajectory.length; i++) {
        const p1 = toScreen(this.trajectory[i - 1].normX, this.trajectory[i - 1].normY);
        const p2 = toScreen(this.trajectory[i].normX, this.trajectory[i].normY);
        const progress = i / this.trajectory.length;

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = (2 + progress * 4) * dpr;
        ctx.strokeStyle = `rgba(199, 255, 94, ${0.15 + progress * 0.8})`; // Fading neon lime
        ctx.lineCap = 'round';
        ctx.stroke();

        // Trail glowing particles
        if (i % 2 === 0) {
          ctx.beginPath();
          ctx.arc(p2.x, p2.y, (1.5 + progress * 2) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = '#62e6df';
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 2. Draw Active Shuttlecock Reticle & Speed Tag
    if (this.shuttle) {
      const pt = toScreen(this.shuttle.normX, this.shuttle.normY);

      ctx.save();
      // Outer rotating target ring
      const angle = (now / 200) % (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 14 * dpr, angle, angle + Math.PI * 1.5);
      ctx.strokeStyle = '#c7ff5e';
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();

      // Inner glowing dot
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#c7ff5e';
      ctx.shadowBlur = 10 * dpr;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Speed HUD badge
      ctx.font = `bold ${11 * dpr}px system-ui, sans-serif`;
      ctx.fillStyle = '#07131f';
      const text = `${this.shuttle.speed || 45} km/h`;
      const textW = ctx.measureText(text).width;

      ctx.fillStyle = 'rgba(7, 19, 31, 0.85)';
      ctx.fillRect(pt.x + 16 * dpr, pt.y - 12 * dpr, textW + 10 * dpr, 18 * dpr);
      ctx.strokeStyle = '#c7ff5e';
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(pt.x + 16 * dpr, pt.y - 12 * dpr, textW + 10 * dpr, 18 * dpr);

      ctx.fillStyle = '#c7ff5e';
      ctx.fillText(text, pt.x + 21 * dpr, pt.y + 1 * dpr);
      ctx.restore();
    }

    // 3. Render Landing / Fall Ripples
    for (let i = this.landingRipples.length - 1; i >= 0; i--) {
      const rip = this.landingRipples[i];
      const elapsed = now - rip.startTime;
      if (elapsed > rip.duration) {
        this.landingRipples.splice(i, 1);
        continue;
      }

      const progress = elapsed / rip.duration;
      const radius = (20 + progress * 55) * dpr;
      const alpha = 1 - progress;
      const pt = toScreen(rip.normX, rip.normY);

      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = rip.isIn
        ? `rgba(16, 185, 129, ${alpha})`   // Green if IN
        : `rgba(239, 68, 68, ${alpha})`;    // Red if OUT
      ctx.lineWidth = 3 * dpr;
      ctx.stroke();

      // Landing badge
      ctx.font = `900 ${12 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = rip.isIn ? '#10b981' : '#ef4444';
      ctx.fillText(
        rip.isIn ? `FALL IN (SIDE ${rip.side})` : 'OUT OF BOUNDS',
        pt.x,
        pt.y - radius - 5 * dpr
      );
      ctx.restore();
    }

    // 4. Render Telemetry HUD Bar (Top Right)
    ctx.save();
    ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'right';

    let stateColor = '#62e6df';
    if (this.state === 'IN_RALLY') stateColor = '#c7ff5e';
    if (this.state === 'NET_FAULT') stateColor = '#ef4444';
    if (this.state === 'FALL_DETECTED') stateColor = '#f59e0b';

    ctx.fillStyle = 'rgba(7, 19, 31, 0.75)';
    ctx.fillRect(width - 240 * dpr, 10 * dpr, 230 * dpr, 44 * dpr);
    ctx.strokeStyle = '#26394a';
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(width - 240 * dpr, 10 * dpr, 230 * dpr, 44 * dpr);

    ctx.fillStyle = stateColor;
    ctx.fillText(`AI TRACKER: ${this.state}`, width - 20 * dpr, 28 * dpr);

    ctx.fillStyle = '#91a4b7';
    ctx.fillText(`${this.fps} FPS · Conf: ${Math.round(this.confidence)}% · Shots: ${this.rallyShots}`, width - 20 * dpr, 44 * dpr);
    ctx.restore();
  }
}

// Helper: Cluster sparse candidate pixels into contiguous blobs
function clusterPixelsIntoBlobs(pixels, maxDist = 20) {
  const blobs = [];
  const visited = new Uint8Array(pixels.length);

  for (let i = 0; i < pixels.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;

    const currentBlob = {
      pixels: [pixels[i]],
      minX: pixels[i].x,
      maxX: pixels[i].x,
      minY: pixels[i].y,
      maxY: pixels[i].y,
      sumX: pixels[i].x,
      sumY: pixels[i].y
    };

    const queue = [pixels[i]];
    while (queue.length > 0) {
      const p = queue.shift();

      for (let j = 0; j < pixels.length; j++) {
        if (!visited[j]) {
          const dx = Math.abs(pixels[j].x - p.x);
          const dy = Math.abs(pixels[j].y - p.y);
          if (dx <= maxDist && dy <= maxDist) {
            visited[j] = 1;
            const neighbor = pixels[j];
            currentBlob.pixels.push(neighbor);
            currentBlob.minX = Math.min(currentBlob.minX, neighbor.x);
            currentBlob.maxX = Math.max(currentBlob.maxX, neighbor.x);
            currentBlob.minY = Math.min(currentBlob.minY, neighbor.y);
            currentBlob.maxY = Math.max(currentBlob.maxY, neighbor.y);
            currentBlob.sumX += neighbor.x;
            currentBlob.sumY += neighbor.y;
            queue.push(neighbor);
          }
        }
      }
    }

    currentBlob.cx = currentBlob.sumX / currentBlob.pixels.length;
    currentBlob.cy = currentBlob.sumY / currentBlob.pixels.length;
    blobs.push(currentBlob);
  }

  return blobs;
}
