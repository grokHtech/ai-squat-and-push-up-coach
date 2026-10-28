import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { Coach, PoseAnalyzer, skeletonConnections } from "./coach.js";
import "./style.css";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
  "pose_landmarker_full/float16/latest/pose_landmarker_full.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const context = canvas.getContext("2d");
const startButton = document.querySelector("#start-button");
const cameraState = document.querySelector("#camera-state");
const cameraHint = document.querySelector("#camera-hint");
const placeholder = document.querySelector("#camera-placeholder");
const stageLabel = document.querySelector("#stage-label");
const goodReps = document.querySelector("#good-reps");
const attemptCount = document.querySelector("#attempt-count");
const lastScore = document.querySelector("#last-score");
const scoreTrack = document.querySelector("#score-track");
const movementValue = document.querySelector("#movement-value");
const angleValue = document.querySelector("#angle-value");
const coachCue = document.querySelector("#coach-cue");
const coachCard = document.querySelector("#coach-card");
const setupTip = document.querySelector("#setup-tip");
const exerciseButtons = [...document.querySelectorAll(".exercise-button")];

let exercise = "squat";
let cameraStream = null;
let landmarker = null;
let coach = new Coach(exercise);
let analyzer = new PoseAnalyzer();
let active = false;
let animationFrame = null;
let previousCue = "";

const exerciseName = () => exercise === "squat" ? "Squat" : "Push-up";

function setCue(text, type = "") {
  coachCue.textContent = text;
  coachCard.classList.toggle("is-warning", type === "warning");
  coachCard.classList.toggle("is-positive", type === "positive");
}

function updateSetupTip() {
  setupTip.innerHTML = exercise === "squat"
    ? "<strong>For squats</strong><br />A side view makes depth and heel position easiest to check."
    : "<strong>For push-ups</strong><br />Film from the side with your full body visible in a straight plank.";
  cameraHint.textContent = exercise === "squat"
    ? "Stand back so your shoulders, hips, knees, and feet stay in frame."
    : "Place the camera low and to the side; keep your head and feet in frame.";
}

function drawPose(landmarks) {
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const bones = skeletonConnections();
  context.lineWidth = Math.max(3, width / 280);
  context.lineCap = "round";
  context.strokeStyle = "#b8ff6a";
  for (const [a, b] of bones) {
    if ((landmarks[a].visibility ?? 1) < 0.35 ||
        (landmarks[b].visibility ?? 1) < 0.35) continue;
    context.beginPath();
    context.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    context.lineTo(landmarks[b].x * width, landmarks[b].y * height);
    context.stroke();
  }
  for (const landmark of landmarks) {
    if ((landmark.visibility ?? 1) < 0.4) continue;
    context.beginPath();
    context.arc(landmark.x * width, landmark.y * height,
      Math.max(3, width / 190), 0, Math.PI * 2);
    context.fillStyle = "#efffdf";
    context.fill();
  }
}

function drawIdle() {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function updateStats(state) {
  goodReps.textContent = state.goodReps;
  attemptCount.textContent = `${state.attempts} ${state.attempts === 1 ? "attempt" : "attempts"}`;
  if (state.score === null) {
    lastScore.textContent = "--";
    scoreTrack.style.width = "0%";
  } else {
    lastScore.textContent = state.score;
    scoreTrack.style.width = `${state.score}%`;
  }
  movementValue.textContent = state.phase === "DOWN" ? "Lowering" : "Standing / top";
  if (exercise === "pushup" && state.phase === "UP") movementValue.textContent = "Plank / top";
  angleValue.textContent = `${exercise === "squat" ? "Knee" : "Elbow"} angle: ${Math.round(state.angle)}° · ${state.view}`;
  if (state.cue && state.cue !== previousCue) {
    const positive = state.cue === "Great rep";
    setCue(state.cue, positive ? "positive" : "warning");
  } else if (!state.cue && previousCue) {
    setCue(active ? "Keep your movement controlled." :
      "Start the camera and I’ll guide your next rep.");
  }
  previousCue = state.cue;
  if (state.rep) stageLabel.textContent = state.rep.valid
    ? `REP ${state.rep.rep} · ${state.rep.score}/100`
    : `NO REP · ${state.rep.score}/100`;
}

function showWaitingForPose(message) {
  movementValue.textContent = "Waiting for pose";
  angleValue.textContent = exercise === "squat" ? "Knee angle: --" : "Elbow angle: --";
  stageLabel.textContent = message;
  if (previousCue !== "waiting") {
    setCue("Step back until your full body is visible.");
    previousCue = "waiting";
  }
}

function showCameraError(error) {
  const message = error?.name === "NotAllowedError"
    ? "Camera access was blocked. Allow camera access in your browser settings, then try again."
    : error?.name === "NotFoundError"
      ? "No camera was found. Connect a webcam and try again."
      : `Could not start the camera: ${error?.message ?? "unknown error"}`;
  cameraState.textContent = "CAMERA ERROR";
  cameraHint.textContent = message;
  setCue(message, "warning");
}

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

function processFrame(timestamp) {
  if (!active) return;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrame = requestAnimationFrame(processFrame);
    return;
  }
  const result = landmarker.detectForVideo(video, timestamp);
  const landmarks = result.landmarks?.[0];
  if (landmarks) {
    drawPose(landmarks);
    const metrics = analyzer.analyze(exercise, landmarks, timestamp / 1000);
    if (metrics) {
      const state = coach.update(metrics, timestamp / 1000);
      updateStats(state);
      stageLabel.textContent = `${state.view.toUpperCase()} VIEW · ${state.phase}`;
      if (state.rep) {
        stageLabel.textContent = state.rep.valid
          ? `REP ${state.rep.rep} · ${state.rep.score}/100`
          : `NO REP · ${state.rep.score}/100`;
      }
    } else {
      showWaitingForPose("MOVE INTO FULL VIEW");
    }
  } else {
    drawIdle();
    showWaitingForPose("STEP INTO CAMERA VIEW");
  }
  animationFrame = requestAnimationFrame(processFrame);
}

async function stopCamera() {
  active = false;
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  video.srcObject = null;
  video.classList.remove("is-live");
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
  drawIdle();
  placeholder.hidden = false;
  cameraState.textContent = "CAMERA OFF";
  startButton.innerHTML = '<span class="button-icon" aria-hidden="true">▶</span>Start camera';
  startButton.disabled = false;
  exerciseButtons.forEach((button) => { button.disabled = false; });
  stageLabel.textContent = "READY WHEN YOU ARE";
}

async function startCamera() {
  startButton.disabled = true;
  cameraHint.textContent = "Loading the pose model and requesting camera access…";
  cameraState.textContent = "CONNECTING";
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    video.srcObject = cameraStream;
    await video.play();
    landmarker = await createLandmarker();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    active = true;
    video.classList.add("is-live");
    placeholder.hidden = true;
    cameraState.textContent = "CAMERA LIVE";
    cameraHint.textContent = "Your camera frames are analyzed on this device only.";
    startButton.innerHTML = '<span class="button-icon" aria-hidden="true">■</span>Stop camera';
    startButton.disabled = false;
    exerciseButtons.forEach((button) => { button.disabled = true; });
    coach = new Coach(exercise);
    analyzer = new PoseAnalyzer();
    previousCue = "";
    goodReps.textContent = "0";
    attemptCount.textContent = "0 attempts";
    lastScore.textContent = "--";
    scoreTrack.style.width = "0%";
    movementValue.textContent = "Waiting for pose";
    angleValue.textContent = exercise === "squat" ? "Knee angle: --" : "Elbow angle: --";
    setCue("Step back until your full body is visible.");
    animationFrame = requestAnimationFrame(processFrame);
  } catch (error) {
    showCameraError(error);
    await stopCamera();
    cameraState.textContent = "CAMERA ERROR";
    startButton.disabled = false;
  }
}

startButton.addEventListener("click", async () => {
  if (active) {
    await stopCamera();
    return;
  }
  await startCamera();
});

exerciseButtons.forEach((button) => {
  button.addEventListener("click", () => {
    exercise = button.dataset.exercise;
    coach = new Coach(exercise);
    analyzer = new PoseAnalyzer();
    previousCue = "";
    exerciseButtons.forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    goodReps.textContent = "0";
    attemptCount.textContent = "0 attempts";
    lastScore.textContent = "--";
    scoreTrack.style.width = "0%";
    movementValue.textContent = "Ready";
    angleValue.textContent = "Angle: --";
    stageLabel.textContent = "READY WHEN YOU ARE";
    setCue("Start the camera and I’ll guide your next rep.");
    updateSetupTip();
  });
});

window.addEventListener("pagehide", () => {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  if (landmarker) landmarker.close();
});

updateSetupTip();
