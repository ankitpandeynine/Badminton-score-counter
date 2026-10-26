# RallyVision — AI Badminton Tracking, Media Analysis & Score Counter

RallyVision is a browser-based AI computer vision badminton tracking and scoring console. It uses real-time 60 FPS temporal computer vision and kinematic filtering to detect shuttlecock motion, identify net crossings and court landings, trigger audible and visual alarms for net faults (shuttle on or under the net), allow full court/playable space calibration, analyze uploaded match videos, export AI-annotated videos, and automatically score matches with customizable goals and point logs.

---

## Key Features

### 1. Upload Match Media & Analyze Pre-Recorded Videos
- **Drag & Drop Video Upload**: Upload any match recording (`.mp4`, `.webm`, `.mov`, `.m4v`).
- **Client-Side Privacy**: Processing runs 100% locally in your browser. No video is uploaded to any server.
- **Precision Playback Bar**:
  - Interactive timeline scrubber slider.
  - Frame stepping (`|◀` previous frame, `▶|` next frame) to scrutinize close line calls and net faults.
  - Variable playback speeds: `0.25x` (Super Slow-Mo), `0.5x` (Slow-Mo), `1.0x` (Normal), `1.5x`, `2.0x`.
  - Quick ±5s skip buttons.
- **Interactive Timeline Markers & Jump to Rally**:
  - When points and net faults are detected, timestamps are recorded.
  - In the match history table, click **`▶ 00:14`** on any rally to immediately rewind the video and rewatch that exact rally in slow motion.

### 2. Export & Output Capabilities
- **Export Annotated Video**:
  - Click **"Record & Export Annotated Video"** (`MediaRecorder`).
  - Records the video with all AI visual overlays: court boundary polygon, virtual net tape with mesh, moving shuttlecock target reticle, speed readout (km/h), trajectory ribbons, landing ripples, and the live broadcast score HUD!
  - Automatically downloads as `.webm` or `.mp4`.
- **Capture Frame Snapshot**:
  - Click **"📸 Capture Snapshot"** to download a high-resolution PNG image of the current frame with all active AI trajectory lines, court markers, and score HUD.
- **Export Match Reports**:
  - One-click export to formatted **CSV spreadsheet** with timestamped rally breakdowns.
  - Export to **JSON** for developer analysis.
  - **"📋 Copy Match Summary"** copies a formatted text scorecard to clipboard.

### 3. AI Shuttlecock Tracking & Movement Detection
- **3-Frame Temporal Differencing**: Isolates high-speed projectile motion from background and court reflections.
- **Luminance & Color Segmentation**: High-pass filters for White feathers/nylon, Yellow fluorescent, and Neon Green shuttlecocks.
- **Ballistic Kalman / Kinematic Filter**: Tracks trajectory velocity vectors ($v_x, v_y$) and predicts parabolic flight paths under gravity.
- **Interactive Canvas HUD**:
  - Trajectory ribbon comet trail showing flight paths.
  - Rotating target reticle on detected shuttlecock.
  - Real-time estimated speed readout in km/h.
  - Live AI telemetry: FPS, tracking confidence score, rally shot count, and current flight state (`IDLE`, `IN_RALLY`, `NET_FAULT`, `FALL_DETECTED`).

### 4. Virtual Net & Net Fault Alarm
- **Virtual Net Configuration**: Interactive draggable handles directly on the video canvas for both net posts (Top Cord & Bottom Ground line) with regulation 1.524m height reference.
- **Net Crossing Detection**: Identifies when the shuttlecock crosses above the net cord from Side A to Side B, incrementing the rally shot count and playing an acoustic ping.
- **On Net / Under Net Alarm**:
  - Automatically triggers when the shuttlecock enters the virtual net zone, hits the net tape, or passes underneath the net cord.
  - **Audible Siren / Buzzer**: High-urgency dual-tone buzzer generated via the browser's Web Audio API.
  - **Flashing Visual Banner**: Urgent red pulsating alert banner with court highlights.
  - Includes volume slider, net alarm toggle, and a **"Test Alarm"** button.

### 5. Complete Playable Space (Court Calibration)
- **4-Corner Court Boundary Polygon**: Draggable handles directly on the canvas for Near-Left, Near-Right, Far-Right, and Far-Left court corners.
- **Ray-Casting Boundary Check**: Distinguishes valid in-bounds court landings (**IN**) from **OUT** of bounds.
- **Divided Court Zones**: Automatically separates Side A (Near) and Side B (Far) relative to the virtual net.
- **Quick Presets**: Standard Doubles Court (13.40m × 6.10m), Singles Court (13.40m × 5.18m), and Auto-Align Net to Court Center.

### 6. Camera Settings: Hardware Controls & Software Sharpness
- **Hardware Camera Settings**: Exposure Mode (`continuous` / `manual`), Exposure Compensation EV slider (-2.0 to +2.0 EV) via WebRTC track constraints.
- **Universal Software Image Preprocessing**:
  - **High Contrast Booster** (0.8x to 2.6x): Accentuates white shuttlecocks against dark or wooden gym floors.
  - **Edge Sharpness Filter** (Unsharp mask convolution): Eliminates motion blur to keep the shuttlecock silhouette crisp.
  - **Luma & Motion Threshold Sliders**: Tailor detection sensitivity to any indoor or outdoor lighting condition.
  - **Display View Modes**:
    - *Normal*: Live video with sports analytics HUD.
    - *Enhanced*: High-contrast sharpened stream.
    - *AI Mask*: Real-time binary segmentation mask displaying exactly what the computer vision engine sees.

### 7. Auto-Counter with Custom Fall Count Goal & Match Record
- **Custom Points Goal**: Set target points to 21 (standard BWF), 11, 15, 30, or any custom integer.
- **Sets to Win**: Best of 1, 3, or 5 sets with win-by-2 points rules.
- **Scoring Rules**:
  - *Standard BWF Rule*: When the shuttlecock falls IN on Side A court, Side B gets the point. Net faults award point to opponent.
  - *Direct Fall Rule*: Awards point to the side where the shuttlecock falls (for drill/practice counting).
- **Auto-Award Modes**:
  - *Instant Auto-Award*: Automatically awards point upon landing and announces the score via SpeechSynthesis umpire voice.
  - *3-Second Confirmation Window*: Displays a prompt with 3-second countdown before finalizing the score.
- **Complete Point-by-Point Record (Match History Log)**:
  - Scrollable point log detailing Rally #, Real Time, Video Timestamp, Winning Team, Score Progression, Event Reason (e.g., `Landed in Side A (IN) · 7 shots (3.2s)`), and Auto/Manual tag.
  - Match Statistics: Total Points, Average Shots per rally, Net Faults count, In/Out ratio.

### 8. Interactive AI Testing Station (Simulator)
Built-in scenario simulator allows you to test:
- **Clean Rally**: Trajectory crossing net and landing in-bounds.
- **Hit Net (Alarm)**: Trajectory colliding with virtual net tape.
- **Under Net (Alarm)**: Trajectory passing under virtual net cord.
- **Out of Bounds**: Shuttlecock landing outside playable space boundaries.

---

## How to Run

This is a zero-dependency static web application that runs entirely in the browser using HTML5, CSS3, ES modules, Web Audio API, and Canvas.

1. **Local Server**:
   Start any local HTTP server:
   ```bash
   python3 -m http.server 8000
   ```
   Open `http://localhost:8000` in Chrome, Safari, Firefox, or Edge.

2. **GitHub Pages**:
   Go to your GitHub repository **Settings → Pages → Deploy from branch → main → / (root)**.
