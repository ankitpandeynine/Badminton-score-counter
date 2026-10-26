// js/camera.js - RallyVision Camera & Visual Enhancement Engine
// Hardware WebRTC constraints (exposure, focus, ISO) + Universal Software Sharpness & Contrast

export class CameraManager {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.track = null;
    this.capabilities = {};
    this.settings = {};

    // Camera parameters
    this.targetFps = 60;
    this.resolution = '1080p'; // '720p' | '1080p' | '4k'

    // Software enhancements (applied on canvas / vision pipeline)
    this.filters = {
      brightness: 10,       // -100 to +100 (default slight boost)
      contrast: 1.45,       // 0.5 to 3.0 (boosts shuttlecock contrast against court)
      sharpness: 65,        // 0 to 100 (unsharp mask edge enhancement)
      shuttleColor: 'white',// 'white' | 'yellow' | 'neon'
      lumaThreshold: 200,   // High-pass threshold for shuttlecock brightness (0..255)
      motionThreshold: 18,  // Temporal difference sensitivity (5..60)
      minSize: 4,           // Min blob size (px)
      maxSize: 45           // Max blob size (px)
    };

    // View display mode
    this.viewMode = 'normal'; // 'normal' | 'enhanced' | 'mask'

    // Media file upload support
    this.isMediaFile = false;
    this.mediaUrl = null;
    this.mediaFileName = '';

    // Offscreen canvas for software preprocessing
    this.procCanvas = document.createElement('canvas');
    this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true });
  }

  async getDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async start(deviceId = null, wideAngle = false) {
    this.stop();

    const widthMap = { '720p': 1280, '1080p': 1920, '4k': 3840 };
    const heightMap = { '720p': 720, '1080p': 1080, '4k': 2160 };

    const targetW = widthMap[this.resolution] || 1920;
    const targetH = heightMap[this.resolution] || 1080;

    const videoConstraints = {
      width: { ideal: targetW },
      height: { ideal: targetH },
      frameRate: { ideal: this.targetFps, min: 30 }
    };

    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    }

    if (wideAngle) {
      videoConstraints.advanced = [{ zoom: 1 }];
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints
      });

      this.video.srcObject = this.stream;
      this.track = this.stream.getVideoTracks()[0];

      if (this.track) {
        this.capabilities = this.track.getCapabilities ? this.track.getCapabilities() : {};
        this.settings = this.track.getSettings ? this.track.getSettings() : {};
      }

      await this.video.play();
      return { success: true, capabilities: this.capabilities, settings: this.settings };
    } catch (err) {
      return { success: false, error: err };
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.track = null;
    }
    this.video.srcObject = null;
  }

  // Load an uploaded video/media file for analysis
  async loadMediaFile(file) {
    this.stop();
    this.unloadMediaFile();

    return new Promise((resolve, reject) => {
      try {
        this.mediaUrl = URL.createObjectURL(file);
        this.mediaFileName = file.name;
        this.isMediaFile = true;

        this.video.srcObject = null;
        this.video.src = this.mediaUrl;
        this.video.playsInline = true;
        this.video.muted = true; // Avoid autoplay blocks

        const onLoaded = () => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
          resolve({
            success: true,
            fileName: file.name,
            fileSize: file.size,
            duration: this.video.duration || 0,
            width: this.video.videoWidth || 1280,
            height: this.video.videoHeight || 720
          });
        };

        const onError = (e) => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
          reject(new Error('Failed to load video file: format may be unsupported by browser.'));
        };

        this.video.addEventListener('loadedmetadata', onLoaded);
        this.video.addEventListener('error', onError);
        this.video.load();
      } catch (err) {
        reject(err);
      }
    });
  }

  unloadMediaFile() {
    if (this.mediaUrl) {
      URL.revokeObjectURL(this.mediaUrl);
      this.mediaUrl = null;
    }
    this.isMediaFile = false;
    this.mediaFileName = '';
    this.video.removeAttribute('src');
    this.video.load();
  }

  // Apply Hardware Camera Settings if supported by device driver
  async applyHardwareConstraint(settingName, value) {
    if (!this.track || !this.track.applyConstraints) return false;

    try {
      const advanced = {};

      if (settingName === 'exposureMode') {
        advanced.exposureMode = value; // 'continuous' or 'manual'
      } else if (settingName === 'exposureCompensation') {
        advanced.exposureCompensation = Number(value);
      } else if (settingName === 'exposureTime') {
        advanced.exposureTime = Number(value);
      } else if (settingName === 'whiteBalanceMode') {
        advanced.whiteBalanceMode = value;
      } else if (settingName === 'focusMode') {
        advanced.focusMode = value;
      } else if (settingName === 'focusDistance') {
        advanced.focusDistance = Number(value);
      } else if (settingName === 'iso') {
        advanced.iso = Number(value);
      }

      await this.track.applyConstraints({ advanced: [advanced] });
      this.settings = this.track.getSettings ? this.track.getSettings() : {};
      return true;
    } catch (e) {
      console.warn(`Hardware setting ${settingName} not supported on this camera:`, e.message);
      return false;
    }
  }

  // Update software enhancement filters
  setSoftwareFilter(key, val) {
    if (key in this.filters) {
      this.filters[key] = val;
    }
  }

  // Preprocess a frame with software sharpness & high-contrast
  preprocessFrame(sourceCanvasOrVideo, targetCanvas) {
    const w = targetCanvas.width;
    const h = targetCanvas.height;
    const ctx = targetCanvas.getContext('2d');

    // 1. Draw frame with CSS/Canvas filters for contrast and brightness
    ctx.save();
    const brightnessPct = 100 + this.filters.brightness;
    const contrastPct = Math.round(this.filters.contrast * 100);
    ctx.filter = `contrast(${contrastPct}%) brightness(${brightnessPct}%)`;
    ctx.drawImage(sourceCanvasOrVideo, 0, 0, w, h);
    ctx.restore();

    // 2. If sharpness is high, apply fast 3x3 unsharp convolution kernel
    if (this.filters.sharpness > 20 && w > 0 && h > 0) {
      const k = (this.filters.sharpness / 100) * 0.75;
      applyFastSharpness(ctx, w, h, k);
    }
  }
}

// Fast Unsharp Masking / Sharpness Convolution filter
function applyFastSharpness(ctx, width, height, strength = 0.5) {
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const copy = new Uint8ClampedArray(data);

    const w4 = width * 4;
    const centerFactor = 1 + 4 * strength;

    // Convolve interior pixels
    for (let y = 1; y < height - 1; y++) {
      let idx = y * w4 + 4;
      for (let x = 1; x < width - 1; x++) {
        // Red
        const rTop = copy[idx - w4];
        const rBot = copy[idx + w4];
        const rLeft = copy[idx - 4];
        const rRight = copy[idx + 4];
        const rCenter = copy[idx];
        data[idx] = centerFactor * rCenter - strength * (rTop + rBot + rLeft + rRight);

        // Green
        const gTop = copy[idx - w4 + 1];
        const gBot = copy[idx + w4 + 1];
        const gLeft = copy[idx - 4 + 1];
        const gRight = copy[idx + 4 + 1];
        const gCenter = copy[idx + 1];
        data[idx + 1] = centerFactor * gCenter - strength * (gTop + gBot + gLeft + gRight);

        // Blue
        const bTop = copy[idx - w4 + 2];
        const bBot = copy[idx + w4 + 2];
        const bLeft = copy[idx - 4 + 2];
        const bRight = copy[idx + 4 + 2];
        const bCenter = copy[idx + 2];
        data[idx + 2] = centerFactor * bCenter - strength * (bTop + bBot + bLeft + bRight);

        idx += 4;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } catch {
    // Canvas security or memory limits fallback safely
  }
}
