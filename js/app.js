// js/app.js - RallyVision Application Controller
// Orchestrates Camera, Vision AI, Court Geometry, Audio Alarms, Scoreboard & UI

import { SoundEngine } from './audio.js';
import { CameraManager } from './camera.js';
import { CourtManager } from './court.js';
import { ShuttlecockTrackerAI } from './vision.js';
import { ScoreboardManager } from './scoreboard.js';

// DOM Utilities
const $ = (id) => document.getElementById(id);

class RallyVisionApp {
  constructor() {
    this.video = $('video');
    this.canvas = $('overlay');
    this.ctx = this.canvas.getContext('2d');

    // Subsystems
    this.sound = new SoundEngine();
    this.camera = new CameraManager(this.video);
    this.court = new CourtManager();
    this.vision = new ShuttlecockTrackerAI(this.court, this.camera, this.sound);
    this.score = new ScoreboardManager(this.sound);

    // MediaPipe Pose tracking (optional layer)
    this.poseLandmarker = null;
    this.poseLoading = false;
    this.lastPoseTime = 0;
    this.poses = [];

    // Animation & UI loop
    this.raf = null;
    this.wide = false;
    this.isEditingHandles = true;

    // Video Recording / Output Export
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.recStartTime = 0;
    this.recInterval = null;
    this.inputMode = 'camera'; // 'camera' | 'upload'

    // Toast element for net alarm & confirmations
    this.toastEl = $('alarmBanner');

    this.init();
  }

  init() {
    // 1. Setup Listeners
    this.setupSourceTabs();
    this.setupScoreboardUI();
    this.setupCameraUI();
    this.setupMediaUploadUI();
    this.setupOutputExportUI();
    this.setupEnhancementUI();
    this.setupCourtAndNetUI();
    this.setupSimulatorUI();
    this.setupAudioUI();
    this.setupCanvasInteractions();

    // 2. Wire Vision AI Callbacks
    this.vision.onNetCrossing = (data) => {
      this.handleNetCrossing(data);
    };

    this.vision.onNetFault = (data) => {
      this.handleNetFault(data);
    };

    this.vision.onShuttleLanded = (data) => {
      this.handleShuttleLanded(data);
    };

    this.vision.onStateChange = (state) => {
      $('aiStateBadge').textContent = `AI: ${state}`;
      $('aiStateBadge').className = `badge state-${state.toLowerCase()}`;
    };

    // 3. Wire Scoreboard Callbacks
    this.score.onUpdate = () => {
      this.renderScoreboard();
    };

    this.score.onGameOver = (winner) => {
      $('matchStatus').textContent = `🏆 Match Finished! ${winner} Wins!`;
      this.showToast(`🏆 Match Finished! ${winner} Wins!`, 'success', 5000);
    };

    // 4. Initial Render
    this.score.notifyUpdate();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // 5. Update Status
    $('detectionStatus').textContent = 'AI Model Initialized & Ready. Enable camera to begin tracking.';
    $('aiModelPill').textContent = '● AI Model: READY';
    $('aiModelPill').style.color = '#c7ff5e';
  }

  // --- SCOREBOARD UI & AUTO-COUNTER ---
  setupScoreboardUI() {
    // Points buttons
    $('plus1').onclick = () => this.score.awardPoint('A', 'Manual +Point A', { isAuto: false });
    $('plus2').onclick = () => this.score.awardPoint('B', 'Manual +Point B', { isAuto: false });
    $('minus1').onclick = () => {
      this.score.saveSnapshot();
      this.score.scores[0] = Math.max(0, this.score.scores[0] - 1);
      this.score.notifyUpdate();
    };
    $('minus2').onclick = () => {
      this.score.saveSnapshot();
      this.score.scores[1] = Math.max(0, this.score.scores[1] - 1);
      this.score.notifyUpdate();
    };

    $('undoBtn').onclick = () => this.score.undo();
    $('resetBtn').onclick = () => {
      if (confirm('Reset scores, sets, and match history for this match?')) {
        this.score.resetMatch();
        this.vision.reset();
        $('matchStatus').textContent = 'Match reset.';
      }
    };

    // Player names
    $('name1').oninput = (e) => {
      this.score.nameA = e.target.value || 'Player A';
      this.score.notifyUpdate();
    };
    $('name2').oninput = (e) => {
      this.score.nameB = e.target.value || 'Player B';
      this.score.notifyUpdate();
    };

    // Custom Goal input
    $('goalInput').onchange = (e) => {
      this.score.setTargetGoal(e.target.value);
    };

    // Sets to win
    $('setsToWinSelect').onchange = (e) => {
      this.score.setSetsToWin(e.target.value);
    };

    // Auto-Counter toggle & settings
    $('autoScore').onchange = (e) => {
      this.score.autoCounterEnabled = e.target.checked;
      $('autoScoreStatus').textContent = e.target.checked ? 'Active' : 'Paused';
    };

    $('scoringRuleSelect').onchange = (e) => {
      this.score.scoringRule = e.target.value;
    };

    $('autoModeSelect').onchange = (e) => {
      this.score.autoMode = e.target.value;
    };

    // Export buttons
    $('exportCsvBtn').onclick = () => this.score.exportCSV();
    $('exportJsonBtn').onclick = () => this.score.exportJSON();
  }

  renderScoreboard() {
    $('score1').textContent = this.score.scores[0];
    $('score2').textContent = this.score.scores[1];
    $('sets1').textContent = this.score.sets[0];
    $('sets2').textContent = this.score.sets[1];

    $('card1').classList.toggle('active', this.score.scores[0] >= this.score.scores[1] && this.score.scores[0] > 0);
    $('card2').classList.toggle('active', this.score.scores[1] >= this.score.scores[0] && this.score.scores[1] > 0);

    $('targetGoalBadge').textContent = `${this.score.targetGoal} POINTS GOAL`;

    // Render Point History Table
    this.renderHistoryTable();

    // Render Analytics
    const stats = this.score.getStatistics();
    $('totalRalliesStat').textContent = stats.totalPoints;
    $('avgShotsStat').textContent = stats.avgShots;
    $('netFaultsStat').textContent = stats.netFaults;
    $('inOutStat').textContent = `${stats.inPoints}/${stats.outPoints}`;
  }

  renderHistoryTable() {
    const tbody = $('historyTableBody');
    if (!tbody) return;

    if (!this.score.pointHistory.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:18px;">No points recorded yet. Points will appear here automatically when the shuttlecock falls.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.score.pointHistory.slice(0, 35).map(p => {
      const jumpHtml = (p.videoTime != null && this.camera.isMediaFile)
        ? `<button class="jumpBtn" data-vtime="${p.videoTime}" title="Jump video to this rally">▶ ${p.videoTimeStr || 'Replay'}</button>`
        : '';

      return `
        <tr class="${p.winner === 'A' ? 'row-winner-a' : 'row-winner-b'}">
          <td><strong>#${p.id}</strong></td>
          <td>${p.time}${jumpHtml}</td>
          <td><span class="winner-tag tag-${p.winner.toLowerCase()}">${p.winnerName}</span></td>
          <td><strong>${p.scoreA} - ${p.scoreB}</strong></td>
          <td><small>${p.reason}</small></td>
          <td>${p.isAuto ? '<span class="badge badge-ai">AI AUTO</span>' : '<span class="badge badge-manual">MANUAL</span>'}</td>
        </tr>
      `;
    }).join('');

    // Wire jump-to-time buttons
    tbody.querySelectorAll('.jumpBtn').forEach(btn => {
      btn.onclick = (e) => {
        const vtime = Number(e.currentTarget.getAttribute('data-vtime'));
        if (!isNaN(vtime) && this.video.src) {
          this.video.currentTime = Math.max(0, vtime - 1.5);
          this.video.play().catch(() => {});
          this.showToast(`⏪ Jumping to Rally #${btn.closest('tr').querySelector('strong').textContent} at ${this.formatTime(vtime)}`, 'info', 1800);
        }
      };
    });
  }

  // --- SOURCE TABS (CAMERA VS MEDIA UPLOAD) ---
  setupSourceTabs() {
    $('tabCameraBtn').onclick = () => {
      this.inputMode = 'camera';
      $('tabCameraBtn').classList.add('active');
      $('tabUploadBtn').classList.remove('active');
      $('cameraControlsBox').classList.remove('hidden');
      $('uploadControlsBox').classList.add('hidden');
      $('placeholderIcon').textContent = '▣';
      $('placeholderTitle').textContent = 'Your court will appear here';
      $('placeholderNote').textContent = 'Enable the camera to track shuttlecock movement, net crossings, and court falls.';
    };

    $('tabUploadBtn').onclick = () => {
      this.inputMode = 'upload';
      $('tabUploadBtn').classList.add('active');
      $('tabCameraBtn').classList.remove('active');
      $('uploadControlsBox').classList.remove('hidden');
      $('cameraControlsBox').classList.add('hidden');
      $('placeholderIcon').textContent = '📁';
      $('placeholderTitle').textContent = 'Upload a badminton match video';
      $('placeholderNote').textContent = 'Drag and drop or select a video file (MP4, WebM, MOV) to analyze trajectories, net faults, and scores.';

      // Stop live camera if running
      if (this.camera.stream) {
        this.stopCamera();
      }
    };
  }

  // --- MEDIA FILE UPLOAD & PLAYBACK ---
  setupMediaUploadUI() {
    const dropZone = $('dropZone');
    const fileInput = $('mediaUploadInput');

    // Click to browse
    dropZone.onclick = (e) => {
      if (e.target.tagName !== 'INPUT') {
        fileInput.click();
      }
    };

    // File input change
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleFileUpload(file);
      }
    };

    // Drag and drop events
    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        this.handleFileUpload(file);
      }
    });

    // Playback buttons
    const playPauseBtn = $('mediaPlayPause');
    playPauseBtn.onclick = () => {
      if (!this.video.src) return;
      if (this.video.paused) {
        this.video.play().then(() => {
          playPauseBtn.textContent = '⏸ Pause';
        }).catch(err => alert('Playback failed: ' + err.message));
      } else {
        this.video.pause();
        playPauseBtn.textContent = '▶ Play';
      }
    };

    // Timeline Scrubber
    const scrubber = $('mediaTimeline');
    scrubber.oninput = (e) => {
      if (!this.video.src) return;
      this.video.currentTime = Number(e.target.value);
      this.updateMediaTimeDisplay();
    };

    // Frame Step & Jump
    $('mediaPrevFrame').onclick = () => {
      if (!this.video.src) return;
      this.video.pause();
      playPauseBtn.textContent = '▶ Play';
      this.video.currentTime = Math.max(0, this.video.currentTime - 0.04);
      this.updateMediaTimeDisplay();
    };

    $('mediaNextFrame').onclick = () => {
      if (!this.video.src) return;
      this.video.pause();
      playPauseBtn.textContent = '▶ Play';
      this.video.currentTime = Math.min(this.video.duration || 0, this.video.currentTime + 0.04);
      this.updateMediaTimeDisplay();
    };

    $('mediaBack5s').onclick = () => {
      if (!this.video.src) return;
      this.video.currentTime = Math.max(0, this.video.currentTime - 5);
      this.updateMediaTimeDisplay();
    };

    $('mediaFwd5s').onclick = () => {
      if (!this.video.src) return;
      this.video.currentTime = Math.min(this.video.duration || 0, this.video.currentTime + 5);
      this.updateMediaTimeDisplay();
    };

    $('mediaSpeedSelect').onchange = (e) => {
      this.video.playbackRate = Number(e.target.value);
    };

    // Video events
    this.video.addEventListener('timeupdate', () => {
      if (!this.camera.isMediaFile) return;
      scrubber.value = this.video.currentTime;
      this.updateMediaTimeDisplay();
    });

    this.video.addEventListener('play', () => {
      playPauseBtn.textContent = '⏸ Pause';
    });

    this.video.addEventListener('pause', () => {
      playPauseBtn.textContent = '▶ Play';
    });

    this.video.addEventListener('ended', () => {
      playPauseBtn.textContent = '▶ Replay';
      this.showToast('Match video finished. All rallies analyzed!', 'info', 3000);
      if (this.isRecording) {
        this.stopRecording();
      }
    });
  }

  async handleFileUpload(file) {
    this.sound.init(); // Unlock Web Audio
    $('cameraStatus').textContent = `Loading ${file.name}…`;

    try {
      const meta = await this.camera.loadMediaFile(file);

      this.video.classList.remove('hidden');
      $('placeholder').classList.add('hidden');
      $('mediaInfoBar').classList.remove('hidden');
      $('mediaControls').classList.remove('hidden');

      $('mediaFileNameDisplay').textContent = meta.fileName;
      $('mediaResolutionDisplay').textContent = `${meta.width} × ${meta.height} (${this.formatTime(meta.duration)})`;

      $('cameraStatus').textContent = `Video loaded · Ready`;
      $('matchStatus').textContent = `Uploaded: ${meta.fileName} · Press Play to start AI analysis`;

      // Set scrubber range
      const scrubber = $('mediaTimeline');
      scrubber.min = 0;
      scrubber.max = meta.duration;
      scrubber.value = 0;

      this.updateMediaTimeDisplay();
      this.resizeCanvas();
      this.startLoop();

      this.showToast(`✅ Video Loaded: ${meta.fileName}. Hit Play to run AI analysis!`, 'success', 3500);
    } catch (err) {
      alert('Error loading video: ' + err.message);
      $('cameraStatus').textContent = 'Video load error';
    }
  }

  updateMediaTimeDisplay() {
    const cur = this.video.currentTime || 0;
    const dur = this.video.duration || 0;
    $('mediaTimeDisplay').textContent = `${this.formatTime(cur)} / ${this.formatTime(dur)}`;
  }

  formatTime(sec) {
    if (isNaN(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // --- OUTPUT EXPORT (RECORD ANNOTATED VIDEO, SNAPSHOTS, REPORTS) ---
  setupOutputExportUI() {
    $('recordOutputBtn').onclick = () => {
      if (this.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording();
      }
    };

    $('snapshotBtn').onclick = () => {
      this.captureSnapshot();
    };

    $('copySummaryBtn').onclick = () => {
      this.copyMatchSummary();
    };
  }

  startRecording() {
    if (this.isRecording) return;
    this.sound.init();

    if (!window.MediaRecorder) {
      alert('MediaRecorder is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      this.recordedChunks = [];
      const stream = this.canvas.captureStream(30);

      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
      ];
      const selectedMime = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';

      this.mediaRecorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const type = this.mediaRecorder.mimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const baseName = this.camera.isMediaFile ? this.camera.mediaFileName.replace(/\.[^/.]+$/, "") : "LiveMatch";
        a.download = `RallyVision_AI_Annotated_${baseName}_${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast('🎬 Annotated Video Successfully Downloaded!', 'success', 4000);
      };

      this.mediaRecorder.start(200);
      this.isRecording = true;
      this.recStartTime = Date.now();

      // UI updates
      $('recordOutputBtn').classList.add('recording');
      $('recordBtnText').textContent = '⏹ Stop & Save Video';
      $('recordingTimerBadge').classList.remove('hidden');

      this.recInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.recStartTime) / 1000);
        $('recTimeVal').textContent = this.formatTime(elapsed);
      }, 500);

      // If video is loaded and paused, auto-play it
      if (this.camera.isMediaFile && this.video.paused) {
        this.video.play().catch(() => {});
      }

      this.showToast('🔴 Recording Started! Match footage with AI trajectories and scores is recording.', 'info', 3000);
    } catch (e) {
      alert('Could not start recording: ' + e.message);
    }
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.recInterval) {
      clearInterval(this.recInterval);
      this.recInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    $('recordOutputBtn').classList.remove('recording');
    $('recordBtnText').textContent = 'Record & Export Annotated Video';
    $('recordingTimerBadge').classList.add('hidden');
  }

  captureSnapshot() {
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Create export canvas
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = w;
    snapCanvas.height = h;
    const sCtx = snapCanvas.getContext('2d');

    // 1. Draw video background
    if (this.video.readyState >= 2) {
      sCtx.drawImage(this.video, 0, 0, w, h);
    }

    // 2. Draw court polygon & net
    this.court.render(sCtx, w, h, window.devicePixelRatio || 1);

    // 3. Draw shuttlecock trajectories & reticles
    this.vision.render(sCtx, w, h, window.devicePixelRatio || 1);

    // 4. Draw Score HUD on top of snapshot
    this.drawBroadcastScoreHUD(sCtx, w, h);

    // Trigger download
    const dataUrl = snapCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    const timeTag = this.camera.isMediaFile ? `_${Math.round(this.video.currentTime)}s` : '';
    a.download = `RallyVision_Snapshot_${Date.now()}${timeTag}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    this.showToast('📸 Frame Snapshot Captured and Downloaded!', 'success', 2500);
  }

  drawBroadcastScoreHUD(ctx, width, height) {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    // Modern broadcast banner at top-left
    const bannerW = 280 * dpr;
    const bannerH = 34 * dpr;
    const x = 16 * dpr;
    const y = 14 * dpr;

    ctx.fillStyle = 'rgba(7, 19, 31, 0.88)';
    ctx.fillRect(x, y, bannerW, bannerH);
    ctx.strokeStyle = '#26394a';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(x, y, bannerW, bannerH);

    ctx.font = `bold ${12 * dpr}px system-ui, sans-serif`;

    // Team A
    ctx.fillStyle = '#c7ff5e';
    ctx.fillText(this.score.nameA.slice(0, 10).toUpperCase(), x + 10 * dpr, y + 21 * dpr);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${14 * dpr}px system-ui, sans-serif`;
    ctx.fillText(String(this.score.scores[0]), x + 95 * dpr, y + 22 * dpr);

    // Divider
    ctx.fillStyle = '#37516d';
    ctx.fillRect(x + 120 * dpr, y + 6 * dpr, 2 * dpr, bannerH - 12 * dpr);

    // Team B
    ctx.font = `900 ${14 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(this.score.scores[1]), x + 138 * dpr, y + 22 * dpr);
    ctx.font = `bold ${12 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = '#62e6df';
    ctx.fillText(this.score.nameB.slice(0, 10).toUpperCase(), x + 165 * dpr, y + 21 * dpr);

    ctx.restore();
  }

  copyMatchSummary() {
    const stats = this.score.getStatistics();
    const summary = [
      `🏸 RallyVision AI Match Report`,
      `==============================`,
      `Player A: ${this.score.nameA} (Sets: ${this.score.sets[0]}) - Score: ${this.score.scores[0]}`,
      `Player B: ${this.score.nameB} (Sets: ${this.score.sets[1]}) - Score: ${this.score.scores[1]}`,
      `Target Goal: ${this.score.targetGoal} Points`,
      `Total Rallies: ${stats.totalPoints}`,
      `Average Shots / Rally: ${stats.avgShots}`,
      `Net Faults: ${stats.netFaults}`,
      `In / Out Ratio: ${stats.inPoints} IN / ${stats.outPoints} OUT`,
      `Max Shuttlecock Speed: ${stats.maxSpeed} km/h`,
      `Longest Rally: ${stats.maxShots} shots`,
      `==============================`,
      `Exported at: ${new Date().toLocaleString()}`
    ].join('\n');

    navigator.clipboard.writeText(summary).then(() => {
      this.showToast('📋 Match Summary Copied to Clipboard!', 'success', 2500);
    }).catch(() => {
      alert(summary);
    });
  }

  // --- CAMERA & STREAM UI ---
  setupCameraUI() {
    $('startCamera').onclick = () => this.startCamera();
    $('stopCamera').onclick = () => this.stopCamera();

    $('cameraSelect').onchange = () => {
      if (this.camera.stream) this.startCamera();
    };

    $('wideToggle').onclick = () => {
      this.wide = !this.wide;
      $('wideToggle').textContent = `Wide-angle: ${this.wide ? 'ON' : 'OFF'}`;
      if (this.camera.stream) this.startCamera();
    };

    $('viewMode').onchange = () => {
      this.video.style.objectFit = $('viewMode').value;
    };

    $('visionModeSelect').onchange = (e) => {
      this.camera.viewMode = e.target.value;
    };
  }

  async startCamera() {
    this.sound.init(); // Resume Web Audio
    const deviceId = $('cameraSelect').value || null;
    $('cameraStatus').textContent = 'Connecting…';

    const result = await this.camera.start(deviceId, this.wide);
    if (result.success) {
      this.video.classList.remove('hidden');
      $('placeholder').classList.add('hidden');
      $('startCamera').disabled = true;
      $('stopCamera').disabled = false;
      $('cameraStatus').textContent = 'Camera Live (60 FPS)';
      $('matchStatus').textContent = 'Camera active · AI tracking running';

      await this.populateCameras();
      this.populateHardwareControls(result.capabilities);
      this.resizeCanvas();
      this.startLoop();

      // Check pose detector
      if ($('detectToggle').checked) {
        this.loadPoseLandmarker();
      }
    } else {
      $('cameraStatus').textContent = 'Camera error';
      alert(`Could not start camera: ${result.error?.message || 'Permission denied'}. Please allow camera permissions.`);
    }
  }

  stopCamera() {
    this.camera.stop();
    this.video.classList.add('hidden');
    $('placeholder').classList.remove('hidden');
    $('startCamera').disabled = false;
    $('stopCamera').disabled = true;
    $('cameraStatus').textContent = 'Camera off';
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  async populateCameras() {
    const devices = await this.camera.getDevices();
    const sel = $('cameraSelect');
    sel.innerHTML = '<option value="">Default camera</option>';
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      sel.appendChild(opt);
    });
  }

  populateHardwareControls(caps) {
    // If exposure compensation is supported by webcam
    if (caps.exposureCompensation) {
      $('hwExposureRow').classList.remove('hidden');
      const s = $('hwExposure');
      s.min = caps.exposureCompensation.min;
      s.max = caps.exposureCompensation.max;
      s.step = caps.exposureCompensation.step || 0.1;
      s.value = this.camera.settings.exposureCompensation || 0;
      s.oninput = (e) => {
        this.camera.applyHardwareConstraint('exposureCompensation', e.target.value);
        $('hwExposureVal').textContent = `${Number(e.target.value).toFixed(1)} EV`;
      };
    }

    if (caps.exposureMode) {
      $('hwExpModeRow').classList.remove('hidden');
      $('hwExpMode').onchange = (e) => {
        this.camera.applyHardwareConstraint('exposureMode', e.target.value);
      };
    }
  }

  // --- SOFTWARE ENHANCEMENT CONTROLS ---
  setupEnhancementUI() {
    $('softContrast').oninput = (e) => {
      const v = Number(e.target.value);
      this.camera.setSoftwareFilter('contrast', v);
      $('softContrastVal').textContent = `${v.toFixed(1)}x`;
    };

    $('softBrightness').oninput = (e) => {
      const v = Number(e.target.value);
      this.camera.setSoftwareFilter('brightness', v);
      $('softBrightnessVal').textContent = `${v > 0 ? '+' : ''}${v}%`;
    };

    $('softSharpness').oninput = (e) => {
      const v = Number(e.target.value);
      this.camera.setSoftwareFilter('sharpness', v);
      $('softSharpnessVal').textContent = `${v}%`;
    };

    $('shuttleColor').onchange = (e) => {
      this.camera.setSoftwareFilter('shuttleColor', e.target.value);
    };

    $('lumaThresh').oninput = (e) => {
      const v = Number(e.target.value);
      this.camera.setSoftwareFilter('lumaThreshold', v);
      $('lumaThreshVal').textContent = v;
    };

    $('motionThresh').oninput = (e) => {
      const v = Number(e.target.value);
      this.camera.setSoftwareFilter('motionThreshold', v);
      $('motionThreshVal').textContent = v;
    };
  }

  // --- COURT & VIRTUAL NET UI ---
  setupCourtAndNetUI() {
    $('presetDoubles').onclick = () => {
      this.court.setPreset('doubles');
      $('calibStatus').textContent = 'Loaded Standard Doubles Court (13.40m × 6.10m). Net auto-aligned.';
    };

    $('presetSingles').onclick = () => {
      this.court.setPreset('singles');
      $('calibStatus').textContent = 'Loaded Standard Singles Court (13.40m × 5.18m). Net auto-aligned.';
    };

    $('toggleHandlesBtn').onclick = () => {
      this.court.interactiveMode = !this.court.interactiveMode;
      $('toggleHandlesBtn').textContent = this.court.interactiveMode
        ? 'Interactive Drag Handles: ON'
        : 'Interactive Drag Handles: OFF';
      $('toggleHandlesBtn').classList.toggle('selected', this.court.interactiveMode);
    };

    $('netHeightInput').oninput = (e) => {
      this.court.netHeight = Number(e.target.value);
    };

    $('courtLengthInput').oninput = (e) => {
      this.court.courtLength = Number(e.target.value);
    };

    $('courtWidthInput').oninput = (e) => {
      this.court.courtWidth = Number(e.target.value);
    };

    $('alignNetMidBtn').onclick = () => {
      this.court.recalcNetMidpoint();
      $('calibStatus').textContent = 'Virtual Net auto-aligned to court center!';
    };
  }

  // --- AUDIO & NET ALARM UI ---
  setupAudioUI() {
    $('soundToggle').onchange = (e) => {
      this.sound.setSoundEnabled(e.target.checked);
    };

    $('netAlarmToggle').onchange = (e) => {
      this.sound.setNetAlarmEnabled(e.target.checked);
    };

    $('voiceToggle').onchange = (e) => {
      this.sound.setVoiceEnabled(e.target.checked);
    };

    $('volumeSlider').oninput = (e) => {
      const vol = Number(e.target.value) / 100;
      this.sound.setVolume(vol);
      $('volumeVal').textContent = `${Math.round(vol * 100)}%`;
    };

    $('testAlarmBtn').onclick = () => {
      this.sound.testAlarm();
      this.showToast('🚨 Net Fault Alarm Test Triggered!', 'warning', 1500);
    };
  }

  // --- SIMULATION / TESTING UI ---
  setupSimulatorUI() {
    $('simRallyClean').onclick = () => {
      this.vision.simulateRally('clean_rally');
      this.showToast('⚡ Simulating: Clean Rally (Side A → Net Crossing → Side B IN)', 'info', 2000);
    };

    $('simRallyNetFault').onclick = () => {
      this.vision.simulateRally('net_fault');
      this.showToast('🚨 Simulating: Shuttlecock Hits Virtual Net!', 'warning', 2000);
    };

    $('simRallyUnderNet').onclick = () => {
      this.vision.simulateRally('under_net');
      this.showToast('🚨 Simulating: Shuttlecock Passes Under Virtual Net!', 'warning', 2000);
    };

    $('simRallyOut').onclick = () => {
      this.vision.simulateRally('out_of_bounds');
      this.showToast('⚡ Simulating: Shuttlecock Lands Out of Bounds!', 'info', 2000);
    };
  }

  // --- CANVAS POINTER INTERACTIONS ---
  setupCanvasInteractions() {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.sound.init(); // Audio unlock
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      const captured = this.court.handlePointerDown(x, y, this.canvas.width, this.canvas.height);
      if (captured) {
        this.canvas.setPointerCapture(e.pointerId);
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      this.court.handlePointerMove(x, y, this.canvas.width, this.canvas.height);
      this.canvas.style.cursor = this.court.activeDrag
        ? 'grabbing'
        : this.court.hoverHandle ? 'grab' : 'crosshair';
    });

    this.canvas.addEventListener('pointerup', (e) => {
      this.court.handlePointerUp();
      try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
    });
  }

  // --- VISION EVENT HANDLERS ---
  handleNetCrossing({ fromSide, toSide, speed, shots }) {
    $('matchStatus').textContent = `⚡ Net Crossed! Side ${fromSide} → Side ${toSide} (${speed} km/h · Shot #${shots})`;
    this.showToast(`Net Crossed! Shot #${shots} (${speed} km/h)`, 'info', 1000);
  }

  handleNetFault(data) {
    const { reason, side } = data;
    const text = reason === 'UNDER_NET'
      ? `🚨 NET FAULT: Shuttlecock went UNDER the net on Side ${side}!`
      : `🚨 NET FAULT: Shuttlecock HIT the virtual net on Side ${side}!`;

    $('matchStatus').textContent = text;
    this.showToast(text, 'alarm', 3000);

    // Auto-Counter receives net fault event
    this.score.handleAutoNetFault(data);
  }

  handleShuttleLanded(data) {
    const { side, isIn, speed, rallyShots, duration } = data;
    const text = isIn
      ? `🎯 Shuttlecock Landed in Side ${side} (IN)! · ${rallyShots} shots`
      : `🚩 Shuttlecock Landed OUT of Bounds (Side ${side})!`;

    $('matchStatus').textContent = text;
    this.showToast(text, isIn ? 'success' : 'warning', 2500);

    // Auto-Counter awards point according to selected rules
    this.score.handleAutoFall(data);
  }

  // --- MAIN RENDER LOOP ---
  startLoop() {
    if (this.raf) return; // Prevent duplicate rAF loops
    const loop = (time) => {
      this.raf = requestAnimationFrame(loop);
      this.drawFrame(time);
    };
    this.raf = requestAnimationFrame(loop);
  }

  drawFrame(time) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;

    this.ctx.clearRect(0, 0, w, h);

    // If recording OR in enhanced mode, draw video background onto canvas
    if (this.isRecording || this.camera.viewMode === 'enhanced') {
      if (this.video.readyState >= 2) {
        if (this.camera.viewMode === 'enhanced') {
          this.camera.preprocessFrame(this.video, this.canvas);
        } else {
          this.ctx.drawImage(this.video, 0, 0, w, h);
        }
      }
    } else if (this.camera.viewMode === 'mask') {
      this.ctx.drawImage(this.vision.maskCanvas, 0, 0, w, h);
    }

    // 1. Process Frame through AI Vision
    if (this.video.readyState >= 2 || this.vision.simulating) {
      this.vision.processFrame(this.video);
    }

    // 2. Render Playable Space Court & Virtual Net
    this.court.render(this.ctx, w, h, dpr);

    // 3. Render Shuttlecock Trajectory & Reticle & HUD
    this.vision.render(this.ctx, w, h, dpr);

    // 4. Draw Score HUD on top of canvas if recording
    if (this.isRecording) {
      this.drawBroadcastScoreHUD(this.ctx, w, h);
    }

    // 5. Render MediaPipe Pose Landmarks if enabled
    if (this.poseLandmarker && $('detectToggle').checked && (time - this.lastPoseTime > 120)) {
      this.lastPoseTime = time;
      this.runPoseDetection(time);
    }
    if (this.poses.length && $('detectToggle').checked) {
      this.renderPoses(dpr);
    }
  }

  // MediaPipe Pose Landmarker
  async loadPoseLandmarker() {
    if (this.poseLandmarker || this.poseLoading) return;
    this.poseLoading = true;
    try {
      const visionPkg = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
      const fileset = await visionPkg.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      this.poseLandmarker = await visionPkg.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 2
      });
      $('detectionStatus').textContent = 'AI Models: Shuttlecock Tracker + Player Pose Active';
    } catch {
      $('detectionStatus').textContent = 'AI Shuttlecock Tracker Active (Pose model optional fallback)';
    } finally {
      this.poseLoading = false;
    }
  }

  runPoseDetection(now) {
    if (!this.poseLandmarker || !this.video.videoWidth) return;
    try {
      const result = this.poseLandmarker.detectForVideo(this.video, now);
      this.poses = result.landmarks || [];
    } catch {}
  }

  renderPoses(dpr) {
    this.ctx.save();
    this.ctx.lineWidth = 1.5 * dpr;
    this.poses.forEach((pose, idx) => {
      this.ctx.strokeStyle = idx ? 'rgba(98, 230, 223, 0.6)' : 'rgba(199, 255, 94, 0.6)';
      this.ctx.fillStyle = this.ctx.strokeStyle;
      for (const p of pose) {
        if (p.visibility !== undefined && p.visibility < 0.4) continue;
        this.ctx.beginPath();
        this.ctx.arc(p.x * this.canvas.width, p.y * this.canvas.height, 2.5 * dpr, 0, Math.PI * 2);
        this.ctx.fill();
      }
    });
    this.ctx.restore();
  }

  resizeCanvas() {
    const wrap = $('videoWrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  showToast(message, type = 'info', duration = 2500) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.className = `alarmBanner toast-${type}`;
    this.toastEl.classList.remove('hidden');

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, duration);
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new RallyVisionApp();
});
