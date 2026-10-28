"""Live squat or push-up coaching from a local webcam.

Usage:
    python live_coach.py
    python live_coach.py --exercise pushup --camera 1
"""
import argparse
import math
import sys
import time

import cv2
import mediapipe as mp

from pose_utils import (angle, create_landmarker, draw_label, joint,
                        landmarks_to_array)
from pushup_form_score import (CUES as PUSHUP_CUES, PLANK_TILT,
                               Person as PushupPerson, body_offset,
                               draw_pushup_skeleton, head_drop, in_plank,
                               is_real_person as is_real_pushup)
from step3_form_score import (CUES as SQUAT_CUES, LIVE_HEEL_LIMIT,
                              LIVE_KNEE_LIMIT, MIN_SEEN_SECONDS,
                              Person as SquatPerson, draw_card, draw_feedback,
                              draw_front_skeleton, draw_side_skeleton,
                              facing_right, heel_rise, is_horizontal,
                              is_real_person as is_real_squat, knee_ratio,
                              torso_lean)


def live_cue(person, exercise):
    faults = person.coach.live
    if not faults:
        return None
    fault = next(iter(faults))
    cues = SQUAT_CUES if exercise == "squat" else PUSHUP_CUES
    return cues.get(fault)


def draw_status(frame, text, y, colour=(40, 40, 40)):
    if not text:
        return
    height, width = frame.shape[:2]
    scale = max(0.55, width / 1400)
    draw_label(frame, text, (width // 2, y), colour, scale=scale, pad=10)


def main():
    parser = argparse.ArgumentParser(
        description="Live webcam form coaching for squats or push-ups.")
    parser.add_argument("--exercise", choices=("squat", "pushup"), default="squat")
    parser.add_argument("--camera", type=int, default=0,
                        help="camera device index (default: 0)")
    parser.add_argument("--people", type=int, choices=(1, 2), default=1,
                        help="maximum people to track (default: 1)")
    parser.add_argument("--width", type=int, default=640,
                        help="requested webcam width (default: 640)")
    parser.add_argument("--height", type=int, default=480,
                        help="requested webcam height (default: 480)")
    args = parser.parse_args()

    if args.camera < 0:
        parser.error("--camera must be zero or greater")
    if args.width <= 0 or args.height <= 0:
        parser.error("--width and --height must be greater than zero")

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        cap.release()
        sys.exit(f"Could not open camera {args.camera}. Check the camera index and permissions.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    fps = cap.get(cv2.CAP_PROP_FPS)
    fps = fps if fps and fps > 0 else 30.0
    landmarker = None
    try:
        landmarker = create_landmarker(args.people)
        people = ([SquatPerson(i, fps) for i in range(args.people)]
                  if args.exercise == "squat"
                  else [PushupPerson(i, fps) for i in range(args.people)])
        frame_idx = -1
        started = time.monotonic()
        last_timestamp_ms = -1
        loop_fps = 0.0
        window_name = f"AI Coach - {args.exercise}"

        print(f"Live {args.exercise} coach started. Press Q or Esc to stop.")
        while True:
            loop_started = time.perf_counter()
            frame_idx = max(frame_idx + 1,
                            int((time.monotonic() - started) * fps))
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError(
                    f"Could not read from camera {args.camera}. Check that it is connected "
                    "and not in use by another application.")

            frame = cv2.flip(frame, 1)
            height, width = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            timestamp_ms = max(last_timestamp_ms + 1,
                               int((time.monotonic() - started) * 1000))
            last_timestamp_ms = timestamp_ms
            result = landmarker.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp_ms)

            bodies = [landmarks_to_array(lms, width, height)
                      for lms in result.pose_landmarks]
            if args.exercise == "squat":
                bodies = [body for body in bodies if is_real_squat(body, height)]
            else:
                bodies = [body for body in bodies
                          if is_real_pushup(body, width, height)]
            bodies.sort(key=lambda body: (body[23, 0] + body[24, 0]) / 2)

            labels = []
            for i, person in enumerate(people):
                if i >= len(bodies):
                    person.smoother.reset()
                    person.knee = None
                    continue
                pts = person.smoother(bodies[i])
                person.seen += 1

                if args.exercise == "squat":
                    person.horizontal += is_horizontal(pts)
                    view = person.view = person.view_detector(pts)
                    if view == "side":
                        side = person.side_chooser(pts)
                        knee = angle(joint(pts, side, "hip"), joint(pts, side, "knee"),
                                     joint(pts, side, "ankle"))
                        lean, heel = torso_lean(pts, side), heel_rise(pts, side)
                        person.knee = knee
                        rep = person.coach.update(
                            knee, frame_idx, "side", lean=lean, heel=heel)
                        heel_up = (person.coach.stage == "DOWN" and
                                   heel - person.coach.baseline() >
                                   LIVE_HEEL_LIMIT)
                        draw_side_skeleton(frame, pts, side, person, lean, heel_up)
                        knee_point = joint(pts, side, "knee")
                        dx = 110 if facing_right(pts, side) else -110
                        labels.append((f"{int(knee)} deg",
                                       (knee_point[0] + dx, knee_point[1]), person.colour))
                    else:
                        knee = person.hip_drop(pts)
                        person.knee = knee
                        rep = person.coach.update(
                            knee, frame_idx, "front", kratio=knee_ratio(pts))
                        draw_front_skeleton(
                            frame, pts, person,
                            knees_in=knee < 140 and
                            knee_ratio(pts) < LIVE_KNEE_LIMIT)
                    labels.append((f"Person {i + 1}",
                                   (pts[0, 0], pts[0, 1] - 60), person.colour))
                else:
                    side = person.side_chooser(pts)
                    direction = (joint(pts, side, "ankle")[:2] -
                                  joint(pts, side, "shoulder")[:2])
                    tilt = math.degrees(math.atan2(
                        abs(direction[1]), abs(direction[0]) + 1e-6))
                    person.horizontal += tilt < PLANK_TILT
                    elbow = angle(joint(pts, side, "shoulder"),
                                  joint(pts, side, "elbow"),
                                  joint(pts, side, "wrist"))
                    offset, head = body_offset(pts, side), head_drop(pts, side)
                    person.knee = elbow
                    if in_plank(pts, side):
                        rep = person.coach.update(elbow, offset, head, frame_idx)
                    else:
                        person.coach.abandon()
                        rep = None
                    draw_pushup_skeleton(frame, pts, side, person, offset, head)
                    elbow_point = joint(pts, side, "elbow")
                    labels.append((f"{int(elbow)} deg",
                                   (elbow_point[0], elbow_point[1] + 70), person.colour))
                    if len(bodies) > 1:
                        labels.append((f"Person {i + 1}",
                                       (pts[0, 0], pts[0, 1] - 70), person.colour))

                if rep:
                    person.flash = int(fps * 0.4)
                    person.feedback, person.feedback_frames = rep, int(fps * 1.5)

            for text, pos, colour in labels:
                draw_label(frame, text, pos, colour)

            card_w = int(width * (0.50 if args.people == 1 else 0.34))
            if height > width:
                card_w = int(width * (0.50 if args.people == 1 else 0.42))
            shown = [person for person in people
                     if person.seen >= fps * MIN_SEEN_SECONDS]
            for slot, person in enumerate(shown):
                x = 30 if slot == 0 else width - card_w - 30
                draw_card(frame, person, x, 30, card_w)
                draw_feedback(frame, person, x,
                              30 + int(250 * card_w / 380) + 8, card_w)
                person.flash = max(0, person.flash - 1)

            active_cue = None
            for person in shown:
                active_cue = live_cue(person, args.exercise)
                if active_cue:
                    break
            cue_y = max(40, height - 35)
            if active_cue:
                draw_status(frame, active_cue.upper(), cue_y, (40, 75, 145))
            else:
                draw_status(frame, "Q / ESC TO QUIT", cue_y)

            elapsed = time.perf_counter() - loop_started
            instantaneous_fps = 1.0 / elapsed if elapsed > 0 else 0.0
            loop_fps = instantaneous_fps if loop_fps == 0 else (
                0.9 * loop_fps + 0.1 * instantaneous_fps)
            cv2.putText(frame, f"{args.exercise.upper()} | {loop_fps:.1f} FPS",
                        (20, height - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.65,
                        (255, 255, 255), 2, cv2.LINE_AA)

            cv2.imshow(window_name, frame)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break

        for person in people:
            coach = person.coach
            print(f"Person {person.index + 1}: {coach.good_reps} good reps out of "
                  f"{len(coach.reps)} attempts, average score {coach.average}")
    finally:
        cap.release()
        if landmarker is not None:
            landmarker.close()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
