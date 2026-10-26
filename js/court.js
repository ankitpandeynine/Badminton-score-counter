// js/court.js - RallyVision Court & Virtual Net Geometry Engine
// Manages Playable Space (4-corner polygon) and Virtual Net (posts, cord & net zone)

export class CourtManager {
  constructor() {
    // Normalized coordinates [0..1] for responsive scaling across canvas sizes
    this.corners = [
      { x: 0.15, y: 0.88, label: 'Near-Left' },  // 0: Near Left
      { x: 0.85, y: 0.88, label: 'Near-Right' }, // 1: Near Right
      { x: 0.72, y: 0.28, label: 'Far-Right' },  // 2: Far Right
      { x: 0.28, y: 0.28, label: 'Far-Left' }    // 3: Far Left
    ];

    // Virtual Net: Top cord line and bottom ground line
    this.net = {
      top1: { x: 0.22, y: 0.52, label: 'Net Top-L' },
      top2: { x: 0.78, y: 0.52, label: 'Net Top-R' },
      bot1: { x: 0.22, y: 0.62, label: 'Net Bot-L' },
      bot2: { x: 0.78, y: 0.62, label: 'Net Bot-R' }
    };

    // Court physical dimensions (meters)
    this.courtLength = 13.40;
    this.courtWidth = 6.10;
    this.netHeight = 1.524; // Regulation 1.524m center (5ft)

    // Interaction state for canvas dragging
    this.activeDrag = null; // { type: 'corner'|'net', index/key: ... }
    this.hoverHandle = null;
    this.interactiveMode = false; // When true, handles can be dragged
    this.netAlarmActive = false;
    this.alarmFlashTime = 0;
  }

  // Set default court presets
  setPreset(type = 'doubles') {
    if (type === 'doubles') {
      this.courtLength = 13.40;
      this.courtWidth = 6.10;
      this.corners = [
        { x: 0.14, y: 0.88, label: 'Near-Left' },
        { x: 0.86, y: 0.88, label: 'Near-Right' },
        { x: 0.72, y: 0.28, label: 'Far-Right' },
        { x: 0.28, y: 0.28, label: 'Far-Left' }
      ];
    } else if (type === 'singles') {
      this.courtLength = 13.40;
      this.courtWidth = 5.18;
      this.corners = [
        { x: 0.20, y: 0.88, label: 'Near-Left' },
        { x: 0.80, y: 0.88, label: 'Near-Right' },
        { x: 0.68, y: 0.28, label: 'Far-Right' },
        { x: 0.32, y: 0.28, label: 'Far-Left' }
      ];
    } else if (type === 'sideview') {
      // Side view perspective where net is vertical in center
      this.corners = [
        { x: 0.08, y: 0.85, label: 'Near-Left' },
        { x: 0.92, y: 0.85, label: 'Near-Right' },
        { x: 0.92, y: 0.55, label: 'Far-Right' },
        { x: 0.08, y: 0.55, label: 'Far-Left' }
      ];
      this.net.top1 = { x: 0.50, y: 0.38, label: 'Net Top-L' };
      this.net.top2 = { x: 0.50, y: 0.38, label: 'Net Top-R' };
      this.net.bot1 = { x: 0.50, y: 0.85, label: 'Net Bot-L' };
      this.net.bot2 = { x: 0.50, y: 0.85, label: 'Net Bot-R' };
      return;
    }

    // Auto-align virtual net to court midpoint
    this.recalcNetMidpoint();
  }

  recalcNetMidpoint() {
    // Interpolate halfway between near and far corners
    const leftMidX = (this.corners[0].x + this.corners[3].x) / 2;
    const leftMidY = (this.corners[0].y + this.corners[3].y) / 2;
    const rightMidX = (this.corners[1].x + this.corners[2].x) / 2;
    const rightMidY = (this.corners[1].y + this.corners[2].y) / 2;

    const netHeightPxNorm = 0.10; // Visual height band

    this.net.bot1 = { x: leftMidX, y: leftMidY, label: 'Net Bot-L' };
    this.net.bot2 = { x: rightMidX, y: rightMidY, label: 'Net Bot-R' };
    this.net.top1 = { x: leftMidX, y: Math.max(0.05, leftMidY - netHeightPxNorm), label: 'Net Top-L' };
    this.net.top2 = { x: rightMidX, y: Math.max(0.05, rightMidY - netHeightPxNorm), label: 'Net Top-R' };
  }

  // Check if a normalized point (x, y) is inside the playable court polygon
  isInsidePlayableSpace(normX, normY) {
    const poly = this.corners;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > normY) !== (yj > normY)) &&
        (normX < (xj - xi) * (normY - yi) / (yj - yi + 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Determine court side relative to the virtual net
  // Returns 'A' (near court / Side A) or 'B' (far court / Side B)
  getSideOfNet(normX, normY) {
    // Use the net top tape line as the divider
    const x1 = this.net.top1.x, y1 = this.net.top1.y;
    const x2 = this.net.top2.x, y2 = this.net.top2.y;

    // Cross product: (x2 - x1)*(y - y1) - (y2 - y1)*(x - x1)
    const cross = (x2 - x1) * (normY - y1) - (y2 - y1) * (normX - x1);

    // Cross > 0 means the point is "below" or in front of the net vector (Side A / Near)
    return cross >= 0 ? 'A' : 'B';
  }

  // Check if a segment crosses the virtual net
  // Returns { crossed: boolean, fromSide: 'A'|'B', toSide: 'A'|'B', point: {x, y}, clearance: number }
  checkNetCrossing(p1, p2) {
    const n1 = this.net.top1;
    const n2 = this.net.top2;

    const crossResult = lineSegmentIntersection(
      p1.x, p1.y, p2.x, p2.y,
      n1.x, n1.y, n2.x, n2.y
    );

    if (crossResult.intersects) {
      const side1 = this.getSideOfNet(p1.x, p1.y);
      const side2 = this.getSideOfNet(p2.x, p2.y);
      if (side1 !== side2) {
        // Compute clearance above net cord (in screen Y: lower Y means higher in air)
        const netYAtCross = n1.y + crossResult.u * (n2.y - n1.y);
        const clearance = netYAtCross - crossResult.y; // Positive = above net tape

        return {
          crossed: true,
          fromSide: side1,
          toSide: side2,
          point: { x: crossResult.x, y: crossResult.y },
          clearance: clearance,
          isAboveNet: clearance >= 0
        };
      }
    }

    return { crossed: false };
  }

  // Check if shuttlecock is ON the net or UNDER the net
  // Returns { isFault: boolean, reason: 'ON_NET' | 'UNDER_NET' | null, point: {x,y} }
  checkNetFault(normX, normY, prevNormX = null, prevNormY = null) {
    // 1. Is point inside the Net Zone polygon (between top cord and bottom line)?
    const netQuad = [
      this.net.top1,
      this.net.top2,
      this.net.bot2,
      this.net.bot1
    ];

    if (pointInPolygon(normX, normY, netQuad)) {
      return { isFault: true, reason: 'ON_NET', point: { x: normX, y: normY } };
    }

    // 2. Did trajectory cross through the net zone or under the top tape?
    if (prevNormX !== null && prevNormY !== null) {
      // Check intersection with bottom ground line
      const crossBot = lineSegmentIntersection(
        prevNormX, prevNormY, normX, normY,
        this.net.bot1.x, this.net.bot1.y, this.net.bot2.x, this.net.bot2.y
      );

      // Check intersection with top cord
      const crossTop = lineSegmentIntersection(
        prevNormX, prevNormY, normX, normY,
        this.net.top1.x, this.net.top1.y, this.net.top2.x, this.net.top2.y
      );

      if (crossBot.intersects || (crossTop.intersects && crossTop.y > this.net.top1.y)) {
        return { isFault: true, reason: 'UNDER_NET', point: { x: normX, y: normY } };
      }
    }

    // 3. Proximity to net top cord when low
    const distToTop = pointToSegmentDistance(normX, normY, this.net.top1, this.net.top2);
    if (distToTop.distance < 0.025 && normY >= this.net.top1.y - 0.01) {
      return { isFault: true, reason: 'ON_NET', point: { x: normX, y: normY } };
    }

    return { isFault: false, reason: null, point: null };
  }

  // Canvas Mouse & Touch Drag Interaction
  handlePointerDown(canvasX, canvasY, width, height) {
    if (!this.interactiveMode) return false;
    const normX = canvasX / width;
    const normY = canvasY / height;
    const hitRadiusNorm = 24 / Math.min(width, height);

    // Check court corners
    for (let i = 0; i < this.corners.length; i++) {
      const c = this.corners[i];
      const d = Math.hypot(c.x - normX, c.y - normY);
      if (d < hitRadiusNorm) {
        this.activeDrag = { type: 'corner', index: i };
        return true;
      }
    }

    // Check net handles
    const netKeys = ['top1', 'top2', 'bot1', 'bot2'];
    for (const key of netKeys) {
      const pt = this.net[key];
      const d = Math.hypot(pt.x - normX, pt.y - normY);
      if (d < hitRadiusNorm) {
        this.activeDrag = { type: 'net', key: key };
        return true;
      }
    }

    return false;
  }

  handlePointerMove(canvasX, canvasY, width, height) {
    const normX = Math.max(0.01, Math.min(0.99, canvasX / width));
    const normY = Math.max(0.01, Math.min(0.99, canvasY / height));

    if (this.activeDrag) {
      if (this.activeDrag.type === 'corner') {
        this.corners[this.activeDrag.index].x = normX;
        this.corners[this.activeDrag.index].y = normY;
      } else if (this.activeDrag.type === 'net') {
        this.net[this.activeDrag.key].x = normX;
        this.net[this.activeDrag.key].y = normY;
      }
      return true;
    }

    // Hover state detection
    if (this.interactiveMode) {
      const hitRadiusNorm = 24 / Math.min(width, height);
      let found = null;
      for (let i = 0; i < this.corners.length; i++) {
        const c = this.corners[i];
        if (Math.hypot(c.x - normX, c.y - normY) < hitRadiusNorm) {
          found = { type: 'corner', index: i };
          break;
        }
      }
      if (!found) {
        const netKeys = ['top1', 'top2', 'bot1', 'bot2'];
        for (const key of netKeys) {
          const pt = this.net[key];
          if (Math.hypot(pt.x - normX, pt.y - normY) < hitRadiusNorm) {
            found = { type: 'net', key: key };
            break;
          }
        }
      }
      this.hoverHandle = found;
    }
    return false;
  }

  handlePointerUp() {
    const wasDragging = !!this.activeDrag;
    this.activeDrag = null;
    return wasDragging;
  }

  // Draw complete court boundaries, inner lines, and virtual net on canvas
  render(ctx, width, height, dpr = 1) {
    const toScreen = (pt) => ({ x: pt.x * width, y: pt.y * height });

    // 1. Draw Playable Court Surface (Shaded Polygon)
    if (this.corners.length === 4) {
      const sc = this.corners.map(toScreen);

      // Filled court area with subtle green glow
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sc[0].x, sc[0].y);
      ctx.lineTo(sc[1].x, sc[1].y);
      ctx.lineTo(sc[2].x, sc[2].y);
      ctx.lineTo(sc[3].x, sc[3].y);
      ctx.closePath();

      ctx.fillStyle = 'rgba(16, 185, 129, 0.08)'; // Semi-transparent emerald
      ctx.fill();

      // Border lines
      ctx.strokeStyle = '#10b981'; // Emerald 500
      ctx.lineWidth = 2.5 * dpr;
      ctx.stroke();

      // Inner Center Service Lines
      const nearMid = { x: (sc[0].x + sc[1].x) / 2, y: (sc[0].y + sc[1].y) / 2 };
      const farMid = { x: (sc[3].x + sc[2].x) / 2, y: (sc[3].y + sc[2].y) / 2 };

      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(110, 231, 183, 0.45)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(nearMid.x, nearMid.y);
      ctx.lineTo(farMid.x, farMid.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Court Side Indicators
      ctx.font = `bold ${11 * dpr}px system-ui, sans-serif`;
      ctx.fillStyle = '#6ee7b7';
      ctx.fillText('SIDE A (NEAR)', sc[0].x + 10 * dpr, sc[0].y - 8 * dpr);
      ctx.fillStyle = '#93c5fd';
      ctx.fillText('SIDE B (FAR)', sc[3].x + 10 * dpr, sc[3].y + 16 * dpr);

      ctx.restore();
    }

    // 2. Draw Virtual Net
    const nt1 = toScreen(this.net.top1);
    const nt2 = toScreen(this.net.top2);
    const nb1 = toScreen(this.net.bot1);
    const nb2 = toScreen(this.net.bot2);

    ctx.save();

    // Check if alarm is flashing
    const isAlarmFlashing = this.netAlarmActive && (Date.now() - this.alarmFlashTime < 2500);

    // Net Mesh Fill (Quadrilateral between top cord and bottom ground)
    ctx.beginPath();
    ctx.moveTo(nt1.x, nt1.y);
    ctx.lineTo(nt2.x, nt2.y);
    ctx.lineTo(nb2.x, nb2.y);
    ctx.lineTo(nb1.x, nb1.y);
    ctx.closePath();

    if (isAlarmFlashing) {
      // Pulsing red alert on net collision
      const pulse = Math.sin(Date.now() / 80) > 0;
      ctx.fillStyle = pulse ? 'rgba(239, 68, 68, 0.45)' : 'rgba(239, 68, 68, 0.15)';
      ctx.strokeStyle = '#ef4444';
    } else {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'; // Cyan mesh tint
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
    }
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    // Net Top Cord (White / Glowing High-Visibility Line)
    ctx.beginPath();
    ctx.moveTo(nt1.x, nt1.y);
    ctx.lineTo(nt2.x, nt2.y);
    ctx.strokeStyle = isAlarmFlashing ? '#ff3b30' : '#ffffff';
    ctx.lineWidth = 3.5 * dpr;
    ctx.shadowColor = isAlarmFlashing ? '#ff3b30' : '#38bdf8';
    ctx.shadowBlur = 10 * dpr;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Net center height badge
    const netMidX = (nt1.x + nt2.x) / 2;
    const netMidY = (nt1.y + nt2.y) / 2;
    ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = isAlarmFlashing ? '#ff3b30' : '#38bdf8';
    ctx.textAlign = 'center';
    ctx.fillText(`VIRTUAL NET · ${this.netHeight.toFixed(3)}m`, netMidX, netMidY - 8 * dpr);
    ctx.textAlign = 'left';

    ctx.restore();

    // 3. Render Draggable Interactive Handles when in Edit/Interactive Mode
    if (this.interactiveMode) {
      ctx.save();

      // Corner handles
      this.corners.forEach((c, idx) => {
        const pt = toScreen(c);
        const isHovered = this.hoverHandle?.type === 'corner' && this.hoverHandle?.index === idx;
        const isDragging = this.activeDrag?.type === 'corner' && this.activeDrag?.index === idx;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (isDragging ? 10 : isHovered ? 8 : 6) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = isHovered || isDragging ? '#c7ff5e' : '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#07131f';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        ctx.font = `bold ${10 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = '#c7ff5e';
        ctx.fillText(`C${idx + 1}: ${c.label}`, pt.x + 8 * dpr, pt.y - 8 * dpr);
      });

      // Net handles
      const netHandles = [
        { pt: nt1, name: 'Net-TL', key: 'top1' },
        { pt: nt2, name: 'Net-TR', key: 'top2' },
        { pt: nb1, name: 'Net-BL', key: 'bot1' },
        { pt: nb2, name: 'Net-BR', key: 'bot2' }
      ];

      netHandles.forEach(({ pt, name, key }) => {
        const isHovered = this.hoverHandle?.type === 'net' && this.hoverHandle?.key === key;
        const isDragging = this.activeDrag?.type === 'net' && this.activeDrag?.key === key;

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (isDragging ? 9 : isHovered ? 7 : 5.5) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = isHovered || isDragging ? '#f43f5e' : '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        ctx.font = `600 ${9 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(name, pt.x + 7 * dpr, pt.y - 6 * dpr);
      });

      ctx.restore();
    }
  }

  triggerAlarmFlash() {
    this.netAlarmActive = true;
    this.alarmFlashTime = Date.now();
    setTimeout(() => {
      this.netAlarmActive = false;
    }, 2500);
  }
}

// Utility: Check if point is in polygon
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Utility: Check line segment intersection
function lineSegmentIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-9) return { intersects: false };

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      intersects: true,
      x: x1 + ua * (x2 - x1),
      y: y1 + ua * (y2 - y1),
      u: ub
    };
  }
  return { intersects: false };
}

// Utility: Distance from point to line segment
function pointToSegmentDistance(px, py, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { distance: Math.hypot(px - p1.x, py - p1.y), projX: p1.x, projY: p1.y };

  let t = ((px - p1.x) * dx + (py - p1.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  return { distance: Math.hypot(px - projX, py - projY), projX, projY };
}
