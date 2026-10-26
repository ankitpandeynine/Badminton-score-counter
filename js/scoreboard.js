// js/scoreboard.js - RallyVision Auto-Counter & Match History Manager
// Manages Custom Target Goal, Auto-Scoring on Shuttlecock Fall, Complete Point Records & Stats

export class ScoreboardManager {
  constructor(soundEngine) {
    this.sound = soundEngine;

    // Names
    this.nameA = 'Player A';
    this.nameB = 'Player B';

    // Game & Match Configuration
    this.targetGoal = 21;    // Custom points goal (11, 15, 21, 30, or custom)
    this.setsToWin = 2;      // Best of 3 (need 2 sets)
    this.winByTwo = true;    // Must lead by 2 points
    this.maxCap = 30;        // Sudden death cap (e.g. 30 in BWF)

    // Current Match State
    this.scores = [0, 0];    // [Score A, Score B]
    this.sets = [0, 0];      // [Sets A, Sets B]
    this.servingSide = 'A';  // 'A' or 'B'
    this.matchOver = false;
    this.matchWinner = null;

    // Auto-Counter Settings
    this.autoCounterEnabled = true;
    this.scoringRule = 'standard'; // 'standard' (opponent gets point on your court fall) | 'direct' (side where it falls gets point)
    this.autoMode = 'instant';     // 'instant' | 'prompt3s'
    this.cooldownSeconds = 3;

    // Match History Log (Complete record of all points)
    this.pointHistory = [];  // Array of PointRecord
    this.undoStack = [];     // Snapshots for undo

    // Confirmation Toast callback / timer
    this.pendingPoint = null;
    this.pendingTimer = null;

    // UI Change callback
    this.onUpdate = null;
    this.onMatchPoint = null;
    this.onGameOver = null;
  }

  // Set custom fall count / score goal
  setTargetGoal(goal) {
    const parsed = parseInt(goal, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 99) {
      this.targetGoal = parsed;
      this.maxCap = Math.max(parsed + 9, 30);
      this.notifyUpdate();
    }
  }

  setSetsToWin(num) {
    const parsed = parseInt(num, 10);
    if (parsed >= 1 && parsed <= 5) {
      this.setsToWin = parsed;
      this.notifyUpdate();
    }
  }

  // Award Point
  awardPoint(winnerSide, reason = 'Point', metadata = {}) {
    if (this.matchOver) return;

    const winnerIdx = winnerSide === 'A' ? 0 : 1;
    const loserIdx = 1 - winnerIdx;

    // Save snapshot for undo
    this.saveSnapshot();

    // Increment score
    this.scores[winnerIdx]++;
    const currentScoreA = this.scores[0];
    const currentScoreB = this.scores[1];

    // Check game / set completion
    let setWon = false;
    let matchWon = false;
    const winnerScore = this.scores[winnerIdx];
    const loserScore = this.scores[loserIdx];

    const reachedGoal = winnerScore >= this.targetGoal;
    const leadsByTwo = (winnerScore - loserScore) >= 2;
    const hitCap = winnerScore >= this.maxCap;

    if (reachedGoal && (!this.winByTwo || leadsByTwo || hitCap)) {
      // Set won!
      this.sets[winnerIdx]++;
      setWon = true;

      // Check if match won
      if (this.sets[winnerIdx] >= this.setsToWin) {
        matchWon = true;
        this.matchOver = true;
        this.matchWinner = winnerSide === 'A' ? this.nameA : this.nameB;
        this.sound.playMatchWonFanfare();
        if (this.onGameOver) this.onGameOver(this.matchWinner);
      } else {
        // Reset game score for next set
        this.scores = [0, 0];
        this.sound.playPointWonSound();
      }
    } else {
      // Normal point
      this.sound.playPointWonSound();

      // Check if match point
      if (winnerScore === this.targetGoal - 1) {
        if (this.onMatchPoint) this.onMatchPoint(winnerSide);
      }
    }

    // Voice announcement
    const winnerName = winnerSide === 'A' ? this.nameA : this.nameB;
    if (matchWon) {
      this.sound.announceScore(`Match point to ${winnerName}! Game and match!`);
    } else if (setWon) {
      this.sound.announceScore(`Game to ${winnerName}!`);
    } else {
      this.sound.announceScore(`Point ${winnerName}. ${this.scores[0]} - ${this.scores[1]}`);
    }

    // Add to complete Point History Log
    const pointRecord = {
      id: this.pointHistory.length + 1,
      time: new Date().toLocaleTimeString(),
      winner: winnerSide,
      winnerName: winnerName,
      scoreA: currentScoreA,
      scoreB: currentScoreB,
      setA: this.sets[0],
      setB: this.sets[1],
      reason: reason,
      shots: metadata.shots || 1,
      duration: metadata.duration || '0.0',
      speed: metadata.speed || 0,
      isAuto: metadata.isAuto !== false,
      videoTime: metadata.videoTime !== undefined ? metadata.videoTime : null,
      videoTimeStr: metadata.videoTime != null ? formatSecondsToTimestamp(metadata.videoTime) : null,
      setWon: setWon,
      matchWon: matchWon
    };

    this.pointHistory.unshift(pointRecord); // Newest first

    this.notifyUpdate();
  }

  // Handle AI Fall Detection Event
  handleAutoFall({ side, isIn, speed, rallyShots, duration, videoTime }) {
    if (!this.autoCounterEnabled || this.matchOver) return;

    let winnerSide = 'A';
    let reason = '';

    if (this.scoringRule === 'standard') {
      // Standard Badminton Rule:
      // If shuttlecock falls IN on Side A court -> Point for Side B (Side A failed to return)
      // If shuttlecock falls IN on Side B court -> Point for Side A (Side B failed to return)
      if (isIn) {
        winnerSide = (side === 'A') ? 'B' : 'A';
        reason = `Landed in Side ${side} (IN) · ${rallyShots} shots (${duration}s)`;
      } else {
        // Shuttlecock fell OUT of bounds:
        // Point awarded to the side whose court it went out on (since opponent hit it out)
        winnerSide = side;
        reason = `Out of Bounds (Side ${side}) · ${rallyShots} shots`;
      }
    } else {
      // Direct Fall Rule: Side where it falls gets point
      winnerSide = side;
      reason = `Fall on Side ${side} (${isIn ? 'IN' : 'OUT'})`;
    }

    if (this.autoMode === 'instant') {
      this.awardPoint(winnerSide, reason, {
        shots: rallyShots,
        duration: duration,
        speed: speed,
        isAuto: true,
        videoTime: videoTime
      });
    } else {
      // 3-Second Confirmation Prompt
      this.triggerPrompt(winnerSide, reason, {
        shots: rallyShots,
        duration: duration,
        speed: speed,
        videoTime: videoTime
      });
    }
  }

  // Handle AI Net Fault Event (On Net or Under Net)
  handleAutoNetFault({ reason, side, videoTime }) {
    if (!this.autoCounterEnabled || this.matchOver) return;

    // In badminton: Player who hit into or under net commits fault; opponent wins point!
    const winnerSide = (side === 'A') ? 'B' : 'A';
    const reasonText = reason === 'UNDER_NET'
      ? `Net Fault: Shuttle passed under net on Side ${side}`
      : `Net Fault: Shuttle hit net cord on Side ${side}`;

    if (this.autoMode === 'instant') {
      this.awardPoint(winnerSide, reasonText, { isAuto: true, videoTime: videoTime });
    } else {
      this.triggerPrompt(winnerSide, reasonText, { videoTime: videoTime });
    }
  }

    // In badminton: Player who hit into or under net commits fault; opponent wins point!
    const winnerSide = (side === 'A') ? 'B' : 'A';
    const reasonText = reason === 'UNDER_NET'
      ? `Net Fault: Shuttle passed under net on Side ${side}`
      : `Net Fault: Shuttle hit net cord on Side ${side}`;

    if (this.autoMode === 'instant') {
      this.awardPoint(winnerSide, reasonText, { isAuto: true });
    } else {
      this.triggerPrompt(winnerSide, reasonText);
    }
  }

  // 3-Second Prompt before auto-awarding point
  triggerPrompt(winnerSide, reason, metadata = {}) {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);

    this.pendingPoint = { winnerSide, reason, metadata, expires: Date.now() + 3000 };
    this.notifyUpdate();

    this.pendingTimer = setTimeout(() => {
      if (this.pendingPoint) {
        this.confirmPendingPoint();
      }
    }, 3000);
  }

  confirmPendingPoint() {
    if (!this.pendingPoint) return;
    const { winnerSide, reason, metadata } = this.pendingPoint;
    this.pendingPoint = null;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.awardPoint(winnerSide, reason, metadata);
  }

  cancelPendingPoint() {
    this.pendingPoint = null;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.notifyUpdate();
  }

  saveSnapshot() {
    this.undoStack.push({
      scores: [...this.scores],
      sets: [...this.sets],
      matchOver: this.matchOver,
      matchWinner: this.matchWinner
    });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  undo() {
    if (!this.undoStack.length) return;
    const snap = this.undoStack.pop();
    this.scores = snap.scores;
    this.sets = snap.sets;
    this.matchOver = snap.matchOver;
    this.matchWinner = snap.matchWinner;

    if (this.pointHistory.length) {
      this.pointHistory.shift(); // Remove latest point from history
    }

    this.notifyUpdate();
  }

  resetMatch() {
    this.scores = [0, 0];
    this.sets = [0, 0];
    this.pointHistory = [];
    this.undoStack = [];
    this.matchOver = false;
    this.matchWinner = null;
    this.pendingPoint = null;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.notifyUpdate();
  }

  // Get Match Analytics
  getStatistics() {
    const totalPoints = this.pointHistory.length;
    let autoCount = 0;
    let netFaultCount = 0;
    let outCount = 0;
    let inCount = 0;
    let maxSpeed = 0;
    let maxShots = 0;
    let totalShots = 0;

    this.pointHistory.forEach(p => {
      if (p.isAuto) autoCount++;
      if (p.reason.includes('Net Fault')) netFaultCount++;
      if (p.reason.includes('Out of Bounds')) outCount++;
      if (p.reason.includes('(IN)')) inCount++;
      if (p.speed > maxSpeed) maxSpeed = p.speed;
      if (p.shots > maxShots) maxShots = p.shots;
      totalShots += (p.shots || 1);
    });

    const avgShots = totalPoints > 0 ? (totalShots / totalPoints).toFixed(1) : '0.0';

    return {
      totalPoints,
      autoPoints: autoCount,
      netFaults: netFaultCount,
      inPoints: inCount,
      outPoints: outCount,
      maxSpeed,
      maxShots,
      avgShots
    };
  }

  // Export Complete Point Record as CSV
  exportCSV() {
    const headers = ['Rally ID', 'Real Time', 'Video Timestamp', 'Winner', 'Score A', 'Score B', 'Set A', 'Set B', 'Reason', 'Shots', 'Duration (s)', 'Speed (km/h)', 'Auto Detected'];
    const rows = this.pointHistory.map(p => [
      p.id,
      `"${p.time}"`,
      `"${p.videoTimeStr || '-'}"`,
      `"${p.winnerName}"`,
      p.scoreA,
      p.scoreB,
      p.setA,
      p.setB,
      `"${p.reason.replace(/"/g, '""')}"`,
      p.shots,
      p.duration,
      p.speed,
      p.isAuto ? 'YES' : 'NO'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `RallyVision_Match_Record_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Export JSON
  exportJSON() {
    const data = {
      matchDate: new Date().toISOString(),
      playerA: this.nameA,
      playerB: this.nameB,
      finalSets: this.sets,
      finalScores: this.scores,
      targetGoal: this.targetGoal,
      stats: this.getStatistics(),
      pointHistory: this.pointHistory
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `RallyVision_Match_Data_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  notifyUpdate() {
    if (this.onUpdate) this.onUpdate();
  }
}

function formatSecondsToTimestamp(sec) {
  if (isNaN(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}
