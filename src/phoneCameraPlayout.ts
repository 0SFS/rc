import { STALE_MS, isAiming, type CameraAim, type ControlFrame } from "./protocol";
import type { PhoneCameraTuning } from "./phoneCameraTuning";

/** Where the gesture has got to: swipe in pads, pinch as a natural log. */
interface Position { yaw: number; pitch: number; zoom: number }
/** A position, the fingers on the pad, and the phone time both were true at. */
interface Sample extends Position { stamp: number; down: number | null }

/** How long the fastest delivery is remembered; longer rides out a quiet spell. */
const TRANSIT_WINDOW_MS = 2_000;
/**
 * Longest stretch between two samples drawn as one steady movement. A longer
 * gap is a finger that rested and then moved, which is drawn as resting until
 * just before the later sample — not as a slow drift across the whole rest.
 */
const MAX_SEGMENT_MS = 40;
/** Playout never trails its target by more than the input stale window. */
const MAX_BEHIND_MS = STALE_MS;
const MAX_SAMPLES = 256;

const ZERO: Position = Object.freeze({ yaw: 0, pitch: 0, zoom: 0 });
const copy = (position: Position): Position => ({ yaw: position.yaw, pitch: position.pitch, zoom: position.zoom });
const same = (left: Position, right: Position) =>
  Math.abs(left.yaw - right.yaw) < 1e-9 && Math.abs(left.pitch - right.pitch) < 1e-9 && Math.abs(left.zoom - right.zoom) < 1e-9;
const lerp = (from: Position, to: Position, amount: number): Position => ({
  yaw: from.yaw + (to.yaw - from.yaw) * amount,
  pitch: from.pitch + (to.pitch - from.pitch) * amount,
  zoom: from.zoom + (to.zoom - from.zoom) * amount,
});

export type PhoneCameraPresentation = Pick<PhoneCameraTuning, "source" | "present" | "bufferMs" | "catchUp" | "predictMs">;

export interface PhoneCameraReceiver {
  /** An accepted control frame, in sequence order. True when it moved the camera or changed the fingers on the pad. */
  receive(frame: ControlFrame, receivedAt: number): boolean;
  /** The movement to draw this rendered frame, or null for none. */
  take(now: number): CameraAim | null;
  /** Movement, or a change in the fingers on the pad, has arrived that has not been drawn yet. */
  pending(): boolean;
  /**
   * The fingers on the phone's camera pad as of what the last `take` drew: in
   * playout, at the playhead's phone time; on arrival, in the newest frame.
   * Null while the phone does not say (one that predates `CameraTotal.down`).
   */
  fingers(): number | null;
  /** When the camera last received movement. */
  lastMovementAt(): number;
  reset(): void;
}

/**
 * Turns the phone's control frames into orbit movement per rendered frame.
 *
 * Every frame is reduced to a position in one of two spaces: the deltas it
 * carried summed in arrival order (`source: "delta"`, the original — a lost
 * frame's movement never arrives) or the phone's running total
 * (`source: "total"` — any later frame carries a lost one's). A frame from a
 * phone that predates the total is read as a delta whatever the setting.
 *
 * `present: "arrival"` then draws whatever has arrived since the last rendered
 * frame (the original). `present: "playout"` draws the position the phone's
 * finger had `bufferMs` behind the fastest delivery seen, interpolated between
 * the phone's own timestamps, so irregular arrival no longer becomes irregular
 * movement. After a stall it catches up at no more than `catchUp` times real
 * speed instead of drawing the backlog in one frame.
 */
export function createPhoneCameraReceiver(getTuning: () => PhoneCameraPresentation): PhoneCameraReceiver {
  let space: "delta" | "total" | null = null;
  let summed = copy(ZERO);
  let newest: Position | null = null;
  let drawn: Position | null = null;
  let movedAt = -Infinity;
  let samples: Sample[] = [];
  // Sliding minimum of (arrival − phone stamp): the least-delayed delivery.
  let transits: Array<{ at: number; transit: number }> = [];
  let playhead: number | null = null;
  let lastTakeAt: number | null = null;
  let newestDown: number | null = null;
  let drawnDown: number | null = null;

  const reset = () => {
    space = null; summed = copy(ZERO); newest = drawn = null; movedAt = -Infinity;
    samples = []; transits = []; playhead = null; lastTakeAt = null; newestDown = drawnDown = null;
  };

  const fastestTransit = (now: number) => {
    while (transits.length > 1 && now - transits[0].at > TRANSIT_WINDOW_MS) transits.shift();
    return transits[0]?.transit ?? 0;
  };

  /** The finger's position at phone time `stamp`, from the samples around it. */
  const positionAt = (stamp: number, predictMs: number): Position => {
    let index = samples.length - 1;
    while (index > 0 && samples[index].stamp > stamp) index -= 1;
    const before = samples[index];
    if (stamp < before.stamp) return copy(before);
    const after = samples[index + 1];
    if (after) {
      const start = Math.max(before.stamp, after.stamp - MAX_SEGMENT_MS);
      return stamp <= start ? copy(before) : lerp(before, after, (stamp - start) / (after.stamp - start));
    }
    const previous = samples[index - 1];
    if (predictMs <= 0 || !previous || before.stamp - previous.stamp > MAX_SEGMENT_MS || before.stamp <= previous.stamp) return copy(before);
    // Past the newest touch: carry on at its last velocity, never further than asked.
    const ahead = Math.min(stamp - before.stamp, predictMs) / (before.stamp - previous.stamp);
    return lerp(previous, before, 1 + ahead);
  };
  /**
   * The fingers down at phone time `stamp`, from the sample `positionAt` draws
   * from: a lift reads only once the movement before it has been drawn, and
   * a landing as soon as any of the movement it brought is.
   */
  const downAt = (stamp: number): number | null => {
    let index = samples.length - 1;
    while (index > 0 && samples[index].stamp > stamp) index -= 1;
    const before = samples[index];
    const after = samples[index + 1];
    // Fewer fingers cannot have made the movement toward more: it is the new touch's.
    if (after && before.down !== null && after.down !== null && after.down > before.down
      && stamp > Math.max(before.stamp, after.stamp - MAX_SEGMENT_MS)) return after.down;
    return before.down;
  };

  const playout = (now: number, tuning: PhoneCameraPresentation): Position => {
    const last = samples[samples.length - 1];
    const target = now - fastestTransit(now) - tuning.bufferMs;
    const limit = last.stamp + tuning.predictMs;
    if (playhead === null) {
      // Joining mid-gesture (a switch from arrival): start where it already drew.
      playhead = drawn && newest && same(drawn, newest) ? last.stamp : Math.min(target, limit);
    } else {
      const elapsed = Math.max(0, now - (lastTakeAt ?? now));
      const reach = tuning.catchUp > 0 ? playhead + elapsed * tuning.catchUp : Infinity;
      let next = Math.min(target, limit, reach);
      if (target - next > MAX_BEHIND_MS) next = Math.min(limit, target - MAX_BEHIND_MS);
      playhead = Math.max(playhead, next);
    }
    // Keep the sample at or before the playhead; older ones can never be drawn again.
    while (samples.length > 2 && samples[1].stamp <= playhead - MAX_SEGMENT_MS) samples.shift();
    drawnDown = downAt(playhead);
    return positionAt(playhead, tuning.predictMs);
  };

  return {
    receive(frame, receivedAt) {
      const tuning = getTuning();
      const total = tuning.source === "total" ? frame.aim : undefined;
      const nextSpace = total ? "total" : "delta";
      const summedBefore = summed;
      if (frame.camera && isAiming(frame.camera)) {
        summed = {
          yaw: summed.yaw + frame.camera.yaw, pitch: summed.pitch + frame.camera.pitch,
          zoom: summed.zoom + Math.log(frame.camera.zoom ?? 1),
        };
      }
      const position: Position = total ? { yaw: total.yaw, pitch: total.pitch, zoom: total.zoom } : copy(summed);
      if (space !== nextSpace) {
        // Start drawing from just before this frame, so its own movement is
        // drawn: a total starts from zero with its epoch, and the first frame
        // to carry one usually follows frames that carried only deltas.
        const own = { yaw: summed.yaw - summedBefore.yaw, pitch: summed.pitch - summedBefore.pitch, zoom: summed.zoom - summedBefore.zoom };
        const base = nextSpace === "delta" ? summedBefore : space === null ? ZERO
          : { yaw: position.yaw - own.yaw, pitch: position.pitch - own.pitch, zoom: position.zoom - own.zoom };
        space = nextSpace;
        newest = copy(base); drawn = copy(base);
        samples = []; playhead = null;
      }
      const moved = !same(position, newest!);
      // The original rule: undrawn movement from a connection that has since
      // stalled is dropped rather than lurching the camera on resume.
      if (moved && tuning.present === "arrival" && receivedAt - movedAt > STALE_MS) drawn = copy(newest!);
      if (moved) movedAt = receivedAt;
      const stamp = frame.aim?.t;
      const down = frame.aim?.down ?? null;
      const counted = down !== newestDown;
      const latest = samples[samples.length - 1];
      if (stamp !== undefined && latest && stamp <= latest.stamp) {
        // Not later than the newest sample: the phone promises this never
        // happens, and the newer position is still the one to end on.
        samples[samples.length - 1] = { ...position, stamp: latest.stamp, down };
      } else if (stamp !== undefined) {
        // A movement with no sample before it: the finger was at rest until just before.
        if (!samples.length && moved) samples.push({ ...newest!, stamp: stamp - MAX_SEGMENT_MS, down: newestDown });
        samples.push({ ...position, stamp, down });
        if (samples.length > MAX_SAMPLES) samples.shift();
        const transit = receivedAt - stamp;
        while (transits.length && transits[transits.length - 1].transit >= transit) transits.pop();
        transits.push({ at: receivedAt, transit });
      }
      newest = position;
      newestDown = down;
      return moved || counted;
    },
    take(now) {
      if (!newest || !drawn) return null;
      const tuning = getTuning();
      let target: Position;
      if (tuning.present === "playout" && samples.length) {
        target = playout(now, tuning);
      } else {
        playhead = null;
        drawnDown = newestDown;
        if (now - movedAt > STALE_MS) { drawn = copy(newest); lastTakeAt = now; return null; }
        target = newest;
      }
      lastTakeAt = now;
      const movement = { yaw: target.yaw - drawn.yaw, pitch: target.pitch - drawn.pitch, zoom: target.zoom - drawn.zoom };
      drawn = copy(target);
      if (same(movement, ZERO)) return null;
      return { yaw: movement.yaw, pitch: movement.pitch, zoom: Math.exp(movement.zoom) };
    },
    pending: () => Boolean(newest && drawn && (!same(newest, drawn) || drawnDown !== newestDown)),
    fingers: () => drawnDown,
    lastMovementAt: () => movedAt,
    reset,
  };
}
