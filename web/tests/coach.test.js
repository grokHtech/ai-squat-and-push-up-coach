import test from "node:test";
import assert from "node:assert/strict";

import { angle, Coach, PoseAnalyzer } from "../src/coach.js";

const squatMetrics = (value, overrides = {}) => ({
  angle: value,
  view: "side",
  lean: 0,
  heel: 0,
  ...overrides,
});

test("angle measures a straight joint as 180 degrees", () => {
  assert.ok(Math.abs(angle([0, 0], [1, 0], [2, 0]) - 180) < 0.01);
});

test("a full-depth, controlled squat is recorded as a good rep", () => {
  const coach = new Coach("squat");
  coach.update(squatMetrics(180), 0);
  coach.update(squatMetrics(150), 1);
  coach.update(squatMetrics(90), 2);
  coach.update(squatMetrics(110), 2.2);
  coach.update(squatMetrics(170), 3);

  assert.equal(coach.reps.length, 1);
  assert.equal(coach.goodReps, 1);
  assert.equal(coach.reps[0].score, 100);
});

test("a shallow squat is recorded as a no-rep", () => {
  const coach = new Coach("squat");
  coach.update(squatMetrics(180), 0);
  coach.update(squatMetrics(150), 1);
  coach.update(squatMetrics(120), 1.5);
  coach.update(squatMetrics(170), 2);

  assert.equal(coach.reps.length, 1);
  assert.equal(coach.goodReps, 0);
  assert.match(coach.reps[0].cue, /No rep/);
});

test("push-ups are not counted outside a plank", () => {
  const coach = new Coach("pushup");
  coach.update({ angle: 90, plank: false, view: "side" }, 1);
  assert.equal(coach.reps.length, 0);
});

test("a full push-up rep is scored after returning to lockout", () => {
  const coach = new Coach("pushup");
  coach.update({ angle: 170, plank: true, offset: 0, head: 0, view: "side" }, 0);
  coach.update({ angle: 140, plank: true, offset: 0, head: 0, view: "side" }, 1);
  coach.update({ angle: 90, plank: true, offset: 0, head: 0, view: "side" }, 2);
  coach.update({ angle: 120, plank: true, offset: 0, head: 0, view: "side" }, 2.3);
  coach.update({ angle: 160, plank: true, offset: 0, head: 0, view: "side" }, 3);

  assert.equal(coach.reps.length, 1);
  assert.equal(coach.goodReps, 1);
  assert.equal(coach.reps[0].score, 100);
});

test("a pike is detected as a no-rep instead of being treated as a straight body", () => {
  const coach = new Coach("pushup");
  coach.update({ angle: 170, plank: true, offset: 0, head: 0, view: "side" }, 0);
  coach.update({ angle: 140, plank: true, offset: -0.11, head: 0, view: "side" }, 1);
  coach.update({ angle: 90, plank: true, offset: -0.11, head: 0, view: "side" }, 2);
  coach.update({ angle: 160, plank: true, offset: -0.11, head: 0, view: "side" }, 3);

  assert.equal(coach.reps.length, 1);
  assert.equal(coach.goodReps, 0);
  assert.match(coach.reps[0].cue, /Lower your hips/);
});

test("side-view squat landmarks remain usable when the far side is occluded", () => {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, visibility: 0.1,
  }));
  const joints = {
    11: [0.45, 0.25], 13: [0.43, 0.35], 15: [0.42, 0.45],
    23: [0.45, 0.5], 25: [0.45, 0.7], 27: [0.45, 0.9],
    29: [0.45, 0.92], 31: [0.5, 0.92],
  };
  for (const [index, [x, y]] of Object.entries(joints)) {
    landmarks[index] = { x, y, visibility: 0.95 };
  }

  const metrics = new PoseAnalyzer().analyze("squat", landmarks, 1);
  assert.ok(metrics);
  assert.equal(metrics.view, "side");
  assert.ok(metrics.angle > 170);
});
