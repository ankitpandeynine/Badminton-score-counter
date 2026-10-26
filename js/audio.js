// js/audio.js - RallyVision Audio Engine
// Web Audio API Synthesizer & SpeechSynthesis Umpire

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.soundEnabled = true;
    this.netAlarmEnabled = true;
    this.voiceEnabled = true;
    this.volume = 0.8;
    this.synth = window.speechSynthesis || null;
    this.alarmActive = false;
    this.alarmStopTimeout = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
  }

  setNetAlarmEnabled(enabled) {
    this.netAlarmEnabled = !!enabled;
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = !!enabled;
  }

  // Net Fault Alarm: Urgent, loud, distinct referee alarm for on/under net
  playNetFaultAlarm(durationMs = 1200) {
    if (!this.soundEnabled || !this.netAlarmEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    // Alarm frequencies (dissonant dual buzzer 620Hz & 659Hz)
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(620, now);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(659, now);

    // Rapid pulsing / siren modulation (10 Hz)
    mod.type = 'square';
    mod.frequency.setValueAtTime(10, now);
    modGain.gain.setValueAtTime(0.35, now);
    mod.connect(modGain.gain);

    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + (durationMs / 1000));

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    mod.start(now);

    const stopTime = now + (durationMs / 1000);
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    mod.stop(stopTime);
  }

  // Subtle clean acoustic ping when shuttle clears the net successfully
  playNetCrossingPing() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(987.77, now); // B5 note
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  // Fall / Landing Chime
  playFallChime(isIn = true) {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    if (isIn) {
      // Warm 2-tone chime for clean in-court landing
      [523.25, 659.25].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.4, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.28);
      });
    } else {
      // Out of bounds: Referee double whistle
      this.playWhistle();
    }
  }

  // Referee whistle sound for out-of-bounds or stoppage
  playWhistle() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2450, now);

    // Whistle warble effect (35Hz frequency vibrato)
    mod.type = 'sine';
    mod.frequency.setValueAtTime(35, now);
    modGain.gain.setValueAtTime(140, now);
    mod.connect(osc.frequency);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    mod.start(now);
    osc.stop(now + 0.38);
    mod.stop(now + 0.38);
  }

  // Point celebration sound
  playPointWonSound() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25]; // A major triad
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.4, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.3);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.32);
    });
  }

  // Match won fanfare
  playMatchWonFanfare() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const chords = [
      { t: 0.0, f: [523.25, 659.25] },
      { t: 0.18, f: [587.33, 739.99] },
      { t: 0.36, f: [659.25, 830.61] },
      { t: 0.58, f: [783.99, 1046.5] }
    ];
    chords.forEach(({ t, f }) => {
      f.forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + t);
        gain.gain.setValueAtTime(0.35, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.45);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now + t);
        osc.stop(now + t + 0.5);
      });
    });
  }

  // Umpire Speech synthesis
  announceScore(text) {
    if (!this.voiceEnabled || !this.synth) return;
    try {
      this.synth.cancel(); // cancel any active speech
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1.0;
      utter.volume = this.volume;
      this.synth.speak(utter);
    } catch {
      // SpeechSynthesis may fail in silent / restricted contexts
    }
  }

  testAlarm() {
    this.init();
    this.playNetFaultAlarm(800);
  }
}
