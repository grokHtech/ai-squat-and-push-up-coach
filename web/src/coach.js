const SIDES = {
  left: {
    shoulder: 11,
    elbow: 13,
    wrist: 15,
    hip: 23,
    knee: 25,
    ankle: 27,
    heel: 29,
    foot: 31,
    ear: 7,
  },
  right: {
    shoulder: 12,
    elbow: 14,
    wrist: 16,
    hip: 24,
    knee: 26,
    ankle: 28,
    heel: 30,
    foot: 32,
    ear: 8,
  },
};

const BONES = [
  [11, 13], [13, 15], [12, 14], [14, 16], [11, 12],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31],
  [24, 26], [26, 28], [28, 32],
];

const SQUAT_CUES = {
  depth: "Go a little deeper",
  lean: "Keep your chest up",
  heels: "Keep your heels down",
  knees: "Push your knees out",
  tempo: "Slow down on the way down",
};

const PUSHUP_CUES = {
  depth: "Bring your chest closer to the floor",
  sag: "Squeeze your glutes and lift your hips",
  pike: "Lower your hips into a straight line",
  tempo: "Slow down on the way down",
  lockout: "Lock out your arms at the top",
  head: "Keep your head in line",
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const point = (landmarks, index) => [landmarks[index].x, landmarks[index].y];
const visibility = (landmarks, index) =>
  landmarks[index]?.visibility ?? landmarks[index]?.presence ?? 1;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function angle(a, b, c) {
  const ba = [a[0] - b[0], a[1] - b[1]];
  const bc = [c[0] - b[0], c[1] - b[1]];
  const denominator = Math.hypot(...ba) * Math.hypot(...bc);
  if (denominator < 1e-9) return 0;
  const cosine = (ba[0] * bc[0] + ba[1] * bc[1]) / denominator;
  return Math.acos(clamp(cosine, -1, 1)) * 180 / Math.PI;
}

function chooseSide(landmarks) {
  const score = (side) => {
    const indices = ["shoulder", "hip", "knee", "ankle"].map((name) => SIDES[side][name]);
    return indices.reduce((sum, index) => sum + visibility(landmarks, index), 0) /
      indices.length;
  };
  return score("left") >= score("right") ? "left" : "right";
}

function averagePoint(landmarks, a, b) {
  const first = point(landmarks, a);
  const second = point(landmarks, b);
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

function torsoLean(landmarks, side) {
  const ids = SIDES[side];
  const shoulder = point(landmarks, ids.shoulder);
  const hip = point(landmarks, ids.hip);
  const vector = [shoulder[0] - hip[0], shoulder[1] - hip[1]];
  return Math.acos(clamp(-vector[1] / (Math.hypot(...vector) + 1e-6), -1, 1)) *
    180 / Math.PI;
}

function kneeRatio(landmarks) {
  const knees = Math.abs(landmarks[25].x - landmarks[26].x);
  const ankles = Math.abs(landmarks[27].x - landmarks[28].x);
  return knees / (ankles + 1e-6);
}

function bodyOffset(landmarks, side) {
  const ids = SIDES[side];
  const shoulder = point(landmarks, ids.shoulder);
  const hip = point(landmarks, ids.hip);
  const ankle = point(landmarks, ids.ankle);
  const length = distance(shoulder, ankle) + 1e-6;
  if (Math.abs(ankle[0] - shoulder[0]) < 1e-3) return 0;
  const lineY = shoulder[1] + (ankle[1] - shoulder[1]) *
    (hip[0] - shoulder[0]) / (ankle[0] - shoulder[0]);
  return (hip[1] - lineY) / length;
}

function headDrop(landmarks, side) {
  const ids = SIDES[side];
  const shoulder = point(landmarks, ids.shoulder);
  const hip = point(landmarks, ids.hip);
  const ear = point(landmarks, ids.ear);
  const up = [shoulder[0] - hip[0], shoulder[1] - hip[1]];
  const head = [ear[0] - shoulder[0], ear[1] - shoulder[1]];
  const cosine = (up[0] * head[0] + up[1] * head[1]) /
    (Math.hypot(...up) * Math.hypot(...head) + 1e-6);
  return Math.acos(clamp(cosine, -1, 1)) * 180 / Math.PI;
}

function isPlank(landmarks, side) {
  const ids = SIDES[side];
  const kneeAngle = angle(point(landmarks, ids.hip), point(landmarks, ids.knee),
    point(landmarks, ids.ankle));
  const shoulder = point(landmarks, ids.shoulder);
  const ankle = point(landmarks, ids.ankle);
  const tilt = Math.atan2(Math.abs(ankle[1] - shoulder[1]),
    Math.abs(ankle[0] - shoulder[0]) + 1e-6) * 180 / Math.PI;
  return kneeAngle > 140 && tilt < 40;
}

export class PoseAnalyzer {
  constructor() {
    this.heightHistory = [];
  }

  analyze(exercise, landmarks, now) {
    const side = chooseSide(landmarks);
    const ids = SIDES[side];
    const sidePoints = [ids.shoulder, ids.hip, ids.knee, ids.ankle];
    const sideConfidence = sidePoints.reduce(
      (sum, index) => sum + visibility(landmarks, index), 0) / sidePoints.length;
    if (sideConfidence < 0.6 ||
        sidePoints.some((index) => visibility(landmarks, index) < 0.25)) return null;

    if (exercise === "pushup") {
      const shoulder = point(landmarks, ids.shoulder);
      const elbow = point(landmarks, ids.elbow);
      const wrist = point(landmarks, ids.wrist);
      return {
        angle: angle(shoulder, elbow, wrist),
        offset: bodyOffset(landmarks, side),
        head: headDrop(landmarks, side),
        plank: isPlank(landmarks, side),
        side,
        view: "side",
      };
    }

    const leftVisibility = [11, 23, 25, 27]
      .reduce((sum, index) => sum + visibility(landmarks, index), 0) / 4;
    const rightVisibility = [12, 24, 26, 28]
      .reduce((sum, index) => sum + visibility(landmarks, index), 0) / 4;
    const visibilityDifference = Math.abs(leftVisibility - rightVisibility);
    const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
    const torsoLength = distance(averagePoint(landmarks, 11, 12),
      averagePoint(landmarks, 23, 24));
    const view = visibilityDifference > 0.3 || shoulderWidth / (torsoLength + 1e-6) < 0.5
      ? "side" : "front";

    if (view === "side") {
      const kneePoint = point(landmarks, ids.knee);
      const value = angle(point(landmarks, ids.hip), kneePoint,
        point(landmarks, ids.ankle));
      const heel = point(landmarks, ids.heel);
      const toe = point(landmarks, ids.foot);
      const shin = distance(kneePoint, point(landmarks, ids.ankle));
      return {
        angle: value,
        heel: (toe[1] - heel[1]) / (shin + 1e-6),
        lean: torsoLean(landmarks, side),
        side,
        view,
      };
    }

    const hipY = averagePoint(landmarks, 23, 24)[1];
    const ankleY = averagePoint(landmarks, 27, 28)[1];
    const height = ankleY - hipY;
    this.heightHistory.push([now, height]);
    this.heightHistory = this.heightHistory.filter(([time]) => now - time <= 4);
    const standing = Math.max(...this.heightHistory.map(([, value]) => value));
    return {
      angle: clamp(180 - 200 * (1 - height / (standing + 1e-6)), 40, 180),
      kneeRatio: kneeRatio(landmarks),
      side,
      view,
    };
  }
}

function pointsLost(value, start, end, lowerIsWorse = false) {
  if (lowerIsWorse) {
    value = -value;
    start = -start;
    end = -end;
  }
  return clamp((value - start) / (end - start), 0, 1);
}

export class Coach {
  constructor(exercise) {
    this.exercise = exercise;
    this.reps = [];
    this.lastRep = null;
    this.lastRepTime = 0;
    this.stage = "UP";
    this.resetAttempt();
  }

  resetAttempt() {
    this.repStart = null;
    this.bottomTime = null;
    this.minimumAngle = 180;
    this.maximumLean = 0;
    this.maximumHeel = 0;
    this.minimumKneeRatio = 9.9;
    this.frontFrames = 0;
    this.sideFrames = 0;
    this.maximumOffset = 0;
    this.maximumHead = 0;
    this.topAngle = 0;
    this.liveCue = "";
  }

  update(metrics, now) {
    if (this.exercise === "pushup") {
      return this.updatePushup(metrics, now);
    }
    return this.updateSquat(metrics, now);
  }

  updateSquat(metrics, now) {
    const knee = metrics.angle;
    if (this.stage === "UP" && knee >= 160 && this.repStart !== null) {
      if (this.minimumAngle < 135) this.finishSquat(now);
      this.resetAttempt();
      this.stage = "UP";
      return this.snapshot(now, metrics);
    }

    if (this.repStart === null && knee < 160) this.repStart = now;
    if (knee < this.minimumAngle) {
      this.minimumAngle = knee;
      this.bottomTime = now;
    }
    if (metrics.view === "front") {
      this.frontFrames += 1;
      if (knee < 140) this.minimumKneeRatio = Math.min(
        this.minimumKneeRatio, metrics.kneeRatio);
      if (knee < 140 && metrics.kneeRatio < 0.8) {
        this.liveCue = SQUAT_CUES.knees;
      }
    } else {
      this.sideFrames += 1;
      this.maximumLean = Math.max(this.maximumLean, metrics.lean);
      this.maximumHeel = Math.max(this.maximumHeel, metrics.heel);
      if (metrics.lean > 50) this.liveCue = SQUAT_CUES.lean;
      else if (this.stage === "DOWN" && metrics.heel > 0.1) {
        this.liveCue = SQUAT_CUES.heels;
      } else if (this.stage === "DOWN" && knee > 100) {
        this.liveCue = SQUAT_CUES.depth;
      }
    }

    if (this.stage === "UP" && knee < 100) {
      this.stage = "DOWN";
    } else if (this.stage === "DOWN" && knee >= 160) {
      this.stage = "UP";
      this.finishSquat(now);
      this.resetAttempt();
    }
    return this.snapshot(now, metrics);
  }

  finishSquat(now) {
    const view = this.frontFrames > this.sideFrames ? "front" : "side";
    const tempo = this.bottomTime === null ? 0 : this.bottomTime - this.repStart;
    let score;
    let mainFault;
    let hardFault = null;

    if (view === "front") {
      const lost = {
        depth: 40 * pointsLost(this.minimumAngle, 90, 115),
        knees: 35 * pointsLost(this.minimumKneeRatio < 9
          ? this.minimumKneeRatio : 1, 0.9, 0.65, true),
        tempo: 25 * pointsLost(tempo, 1, 0.4, true),
      };
      score = Math.round(100 - Object.values(lost).reduce((sum, value) => sum + value, 0));
      mainFault = Object.keys(lost).reduce((a, b) => lost[a] > lost[b] ? a : b);
      if (this.minimumAngle >= 100) hardFault = "depth";
      else if (this.minimumKneeRatio < 0.75) hardFault = "knees";
    } else {
      const lost = {
        depth: 35 * pointsLost(this.minimumAngle, 90, 115),
        lean: 25 * pointsLost(this.maximumLean, 45, 65),
        heels: 15 * pointsLost(this.maximumHeel, 0.06, 0.18),
        tempo: 25 * pointsLost(tempo, 1, 0.4, true),
      };
      score = Math.round(100 - Object.values(lost).reduce((sum, value) => sum + value, 0));
      mainFault = Object.keys(lost).reduce((a, b) => lost[a] > lost[b] ? a : b);
      if (this.minimumAngle >= 100) hardFault = "depth";
      else if (this.maximumLean > 60) hardFault = "lean";
      else if (this.maximumHeel > 0.15) hardFault = "heels";
    }

    const fault = hardFault ?? (score < 70 ? mainFault : null);
    const valid = fault === null;
    const rep = {
      rep: this.reps.length + 1,
      score,
      valid,
      cue: valid ? "Great rep" : `No rep. ${SQUAT_CUES[fault]}`,
      time: now,
      view,
    };
    this.reps.push(rep);
    this.lastRep = rep;
    this.lastRepTime = now;
  }

  updatePushup(metrics, now) {
    if (!metrics.plank) {
      this.stage = "UP";
      this.resetAttempt();
      return this.snapshot(now, metrics);
    }
    const elbow = metrics.angle;
    if (this.stage === "UP") this.topAngle = Math.max(this.topAngle, elbow);
    if (this.stage === "UP" && elbow >= 150 && this.repStart !== null) {
      if (this.minimumAngle < 140) this.finishPushup(now);
      this.resetAttempt();
      this.stage = "UP";
      return this.snapshot(now, metrics);
    }

    if (this.repStart === null && elbow < 150) this.repStart = now;
    if (elbow < this.minimumAngle) {
      this.minimumAngle = elbow;
      this.bottomTime = now;
    }
    if (elbow < 140) {
      if (Math.abs(metrics.offset) > Math.abs(this.maximumOffset)) {
        this.maximumOffset = metrics.offset;
      }
      this.maximumHead = Math.max(this.maximumHead, metrics.head);
      if (metrics.offset > 0.07) this.liveCue = PUSHUP_CUES.sag;
      else if (metrics.offset < -0.07) this.liveCue = PUSHUP_CUES.pike;
      else if (metrics.head > 40) this.liveCue = PUSHUP_CUES.head;
    }
    if (this.stage === "UP" && elbow < 100) {
      this.stage = "DOWN";
    } else if (this.stage === "DOWN" && elbow >= 150) {
      this.stage = "UP";
      this.finishPushup(now);
      this.resetAttempt();
    }
    return this.snapshot(now, metrics);
  }

  finishPushup(now) {
    const lowering = this.bottomTime === null ? 0 : this.bottomTime - this.repStart;
    const offset = Math.abs(this.maximumOffset);
    const lost = {
      depth: 35 * pointsLost(this.minimumAngle, 90, 115),
      body: 30 * pointsLost(offset, 0.05, 0.10),
      tempo: 15 * pointsLost(lowering, 0.5, 0.2, true),
      lockout: 10 * pointsLost(this.topAngle, 160, 140, true),
      head: 10 * pointsLost(this.maximumHead, 30, 50),
    };
    const score = Math.round(100 - Object.values(lost).reduce((sum, value) => sum + value, 0));
    const mainFault = Object.keys(lost).reduce((a, b) => lost[a] > lost[b] ? a : b);
    let hardFault = this.minimumAngle >= 100 ? "depth" : null;
    if (!hardFault && offset > 0.09) {
      hardFault = this.maximumOffset > 0 ? "sag" : "pike";
    }
    const fault = hardFault ?? (score < 70 ? mainFault : null);
    const valid = fault === null;
    const rep = {
      rep: this.reps.length + 1,
      score,
      valid,
      cue: valid ? "Great rep" : `No rep. ${PUSHUP_CUES[fault]}`,
      time: now,
      view: "side",
    };
    this.reps.push(rep);
    this.lastRep = rep;
    this.lastRepTime = now;
  }

  get goodReps() {
    return this.reps.filter((rep) => rep.valid).length;
  }

  get averageScore() {
    if (!this.reps.length) return null;
    return Math.round(this.reps.reduce((sum, rep) => sum + rep.score, 0) /
      this.reps.length);
  }

  snapshot(now, metrics) {
    const showLastRep = this.lastRep && now - this.lastRepTime < 3;
    return {
      phase: this.stage,
      goodReps: this.goodReps,
      attempts: this.reps.length,
      average: this.averageScore,
      score: showLastRep ? this.lastRep.score : null,
      cue: this.liveCue || (showLastRep ? this.lastRep.cue : ""),
      angle: metrics.angle,
      view: metrics.view,
      rep: showLastRep ? this.lastRep : null,
    };
  }
}

export function skeletonConnections() {
  return BONES;
}
