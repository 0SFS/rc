import type { ControlSurfaceState } from "@0sfs/controls/flightInputManager";
import type { EngineRunState } from "@0sfs/engines/engineControl";
import type { EngineRotorBladeCounts } from "@0sfs/engines/engineRotorDefinitions";
import type { EngineOrbSettings } from "@0sfs/engines/engineOrbSettings";
import type { QuadEngineReading } from "@0sfs/engines/quadEngineMonitor";
import type { ControlCapabilities } from "@0sfs/aircraft/aircraftCatalog";

export type { ControlCapabilities, ControlSurfaceState, EngineOrbSettings, EngineRunState };
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MISMATCH_MESSAGE = "Unsupported phone protocol. Reload both devices.";
export const MAX_MESSAGE_BYTES = 2048;
export const STALE_MS = 250;
/** Total time since the last valid phone controls before its live participation expires. */
export const PHONE_CONNECTION_LOSS_MS = 5000;
export const HANDOFF_MS = 2000;
export const CONTROL_INTERVAL_MS = 1000 / 60;
export const HEARTBEAT_MS = 50;
export const FLAP_PRESETS = [0, 1 / 3, 2 / 3, 1] as const;
/** Additive heartbeat field; v1 peers without it simply ignore the key. */
export const HAPTIC_FEEDBACK_VERSION = 1;
export const MAX_HAPTIC_PULSE_MS = 60;
/** Feedback older than this is dropped by the host and must not be scheduled beyond it by the phone. */
export const HAPTIC_FEEDBACK_TTL_MS = 90;

/**
 * Everything the desktop HUD's engine widget draws, so the phone can draw the
 * same widget. A value the flight model does not publish is absent, never zero
 * — the widget decides what an absent value looks like, on both screens.
 *
 * `phase` travels as the label the HUD already derived ("RUNNING", "STARTING"),
 * not as an id: a phase added to the flight model still prints on an older
 * controller, which only loses the colour it cannot look up.
 */
export interface EngineStatus {
  phase: string;
  kind?: "piston" | "turbine";
  /** Per-row blade counts; absent from older hosts, which retain numeric readouts. */
  rotorBlades?: EngineRotorBladeCounts;
  simTimeS?: number;
  maxN1?: number;
  maxN2?: number;
  maxRpm?: number;
  /** The desktop's visible animation budgets also apply to the phone widget. */
  orbs?: EngineOrbSettings;
  /** Aircraft visual accent, present only while its native afterburner is active. */
  afterburnerColor?: string;
  n1?: number;
  n2?: number;
  /** A piston engine's shaft speed; a turbine shows its spools instead. */
  rpm?: number;
  thrustLbf?: number;
  fuelFlowPph?: number;
  /** Only when the model publishes volume flow; otherwise the widget converts. */
  fuelFlowGph?: number;
  /**
   * What the throttle lever shows and lets the pilot do: held to start while
   * `stopped`, ringed while `starting`, held at idle to shut down while
   * `running`. Absent from a host that cannot start or stop its engine, and
   * the phone then draws a plain throttle; additive on v1 like `gearDown`.
   */
  state?: EngineRunState;
  /** How far a start has got, 0 to 1; 1 only once the engine runs. */
  start?: number;
  /** Why a start cannot finish now, such as an empty tank. */
  blocked?: string;
}
export const ENGINE_RUN_STATES: readonly EngineRunState[] = ["running", "starting", "stopped"];

/** Measured actuator positions. A missing member means the model has no observation for it. */
export type ActualControlPositions = Partial<Pick<ControlSurfaceState, "throttle" | "flaps" | "rudder" | "pitchTrim" | "rollTrim">>;

export interface AircraftStatus {
  owner: "local" | "phone";
  paused: boolean;
  viewMode: "first" | "third";
  controls: ControlSurfaceState;
  /** Presentation only; separate from the controls used by handoff and input ownership. */
  actualControls?: ActualControlPositions;
  /** Airframe capabilities; absent on older hosts, which keep their original UI. */
  controlCapabilities?: ControlCapabilities;
  airspeedKts: number;
  altitudeFt: number;
  headingDeg: number;
  /**
   * Absent from a host that predates gear support. The phone treats that as
   * "this host has no gear control" and keeps its G button disabled, so it
   * never sends a `setGearDown` an older host would reject. Advertising the
   * capability this way avoids a protocol version bump for an additive field.
   */
  gearDown?: boolean;
  /**
   * Automatic flaps, which the flaps lever's AUTO turns on and moving the
   * lever turns off. Absent from a host without flap automation, and the
   * phone then offers no AUTO; additive on v1 like `gearDown`.
   */
  autoFlaps?: boolean;
  /**
   * The trim assists, the HUD's AUTO TRIM corner: on, an axis's trim wheel is
   * the assist's and its slider is not the pilot's. Absent from a host without
   * them, and the phone's corner then centres trim instead; additive on v1.
   */
  autoTrim?: { pitch: boolean; roll: boolean };
  /** The throttle's bottom 20% commands wheel brakes; absent on older hosts. */
  throttleBrakeRange?: boolean;
  /** Retain the combined lever's brake setting after release; false/absent springs back to idle. */
  keepSliderBrakes?: boolean;
  /** The throttle where one push of the lever stops short of afterburner; absent lets one push light it. */
  afterburnerDetent?: number;
  /** Absent from a host with no engine reading yet, and from one that predates this field. */
  engine?: EngineStatus;
  /**
   * The computer holds control that this phone flew and never let go of, and
   * gives it back by itself: `now` — ask for it, as if the pilot had tapped
   * Take control; `idle` — once the computer's own flight controls rest.
   * Absent: control comes back only when the pilot asks. Additive on v1 like
   * `gearDown`: an older phone ignores it and shows Take control as before.
   */
  handBack?: HandBack;
  /**
   * Both devices remain live; this says whose input wins where both move a
   * control. The phone's levers then
   * follow `controls`, where the levers are, once the computer has applied the
   * phone's own latest move (`appliedSeq`). Additive on v1: an older phone
   * keeps its levers where it put them.
   */
  blend?: "phone" | "computer";
  /** Present only while the computer is flying an installed quadcopter. */
  drone?: DroneAvailability | DroneTelemetry;
  /** Independent of camera telemetry so malformed camera data cannot hide motor readings. */
  droneMotors?: DroneMotorStatus;
}
export type HandBack = "now" | "idle";

/** Four simulated motor readings, with the same animation budget as the computer. */
export interface DroneMotorStatus extends QuadEngineReading {
  orbs?: EngineOrbSettings;
}

export interface DroneAvailability { available: true }

export type DroneCapturePhase = "idle" | "slewing" | "optical-flow-fine-align" | "settling-zero-velocity" | "capturing" | "next-node" | "zip-export" | "done" | "aborted";

export interface DroneTelemetry {
  available: true;
  droneId: "dji-mini2" | "dji-air2s";
  /** Aircraft heading telemetry may use either -180..180 or 0..360. */
  yawAngleDeg: number;
  gimbalPitchDeg: number;
  gimbalRollDeg: number;
  isSettled: boolean;
  isCapturing: boolean;
  capturePhase: DroneCapturePhase;
  nodeIndex: number;
  nodeCount: number;
  flowConfidence: number;
  flowSource: "visual" | "imu";
  omegaVisualRadPerSec: number;
}

export interface DroneCommand {
  droneId: "dji-mini2" | "dji-air2s";
  pitch: number;
  roll: number;
  vertical: number;
  yaw: number;
  yawMode: "angularVelocity" | "angle";
  yawAngleDeg?: number;
  gimbalPitchDeg: number;
  sport?: boolean;
  shutter?: 1;
  capture360?: boolean;
}

const DRONE_PHASES: readonly DroneCapturePhase[] = ["idle", "slewing", "optical-flow-fine-align", "settling-zero-velocity", "capturing", "next-node", "zip-export", "done", "aborted"];
const DRONE_TELEMETRY_KEYS = ["available", "droneId", "yawAngleDeg", "gimbalPitchDeg", "gimbalRollDeg", "isSettled", "isCapturing", "capturePhase", "nodeIndex", "nodeCount", "flowConfidence", "flowSource", "omegaVisualRadPerSec"] as const;

function inRange(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}

function isDroneId(value: unknown): value is DroneTelemetry["droneId"] {
  return value === "dji-mini2" || value === "dji-air2s";
}

function isDroneAvailability(value: unknown): value is DroneAvailability {
  return record(value) && value.available === true && Object.keys(value).length === 1;
}

function isControlCapabilities(value: unknown): value is ControlCapabilities {
  return record(value) && ["flaps", "pitchTrim", "rollTrim", "landingGear"].every(key => typeof value[key] === "boolean");
}

function isDroneMotorStatus(value: unknown): value is DroneMotorStatus {
  if (!record(value) || typeof value.aircraftId !== "string" || !value.aircraftId.trim() || value.aircraftId.length > 96
    || typeof value.label !== "string" || !value.label.trim() || value.label.length > 96
    || value.source !== "simulated" || !finite(value.hoverRpm) || value.hoverRpm <= 0
    || !finite(value.maxRpm) || value.maxRpm <= 0 || !finite(value.simTimeS) || value.simTimeS < 0
    || !Array.isArray(value.motors) || value.motors.length !== 4
    || (value.orbs !== undefined && !isEngineOrbSettings(value.orbs))) return false;
  const positions = new Set(["front-left", "front-right", "rear-left", "rear-right"]);
  return value.motors.every(motor => record(motor) && positions.delete(motor.position as string)
    && finite(motor.rpm) && motor.rpm >= 0 && (motor.direction === 1 || motor.direction === -1));
}

function isDroneTelemetry(value: unknown): value is DroneTelemetry {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== DRONE_TELEMETRY_KEYS.length || DRONE_TELEMETRY_KEYS.some(key => !keys.includes(key))) return false;
  return value.available === true && isDroneId(value.droneId)
    && inRange(value.yawAngleDeg, -180, 360) && inRange(value.gimbalPitchDeg, -90, 24) && inRange(value.gimbalRollDeg, -180, 180)
    && typeof value.isSettled === "boolean" && typeof value.isCapturing === "boolean"
    && DRONE_PHASES.includes(value.capturePhase as DroneCapturePhase)
    && Number.isInteger(value.nodeIndex) && inRange(value.nodeIndex, 0, 256)
    && Number.isInteger(value.nodeCount) && inRange(value.nodeCount, 0, 256)
    && inRange(value.flowConfidence, 0, 1)
    && (value.flowSource === "visual" || value.flowSource === "imu")
    && inRange(value.omegaVisualRadPerSec, -50, 50);
}

function isDroneCommand(value: unknown): value is DroneCommand {
  if (!record(value)) return false;
  const allowed = ["droneId", "pitch", "roll", "vertical", "yaw", "yawMode", "yawAngleDeg", "gimbalPitchDeg", "sport", "shutter", "capture360"];
  if (Object.keys(value).some(key => !allowed.includes(key))) return false;
  return isDroneId(value.droneId)
    && inRange(value.pitch, -1, 1) && inRange(value.roll, -1, 1) && inRange(value.vertical, -1, 1) && inRange(value.yaw, -1, 1)
    && (value.yawMode === "angularVelocity" || value.yawMode === "angle")
    && (value.yawAngleDeg === undefined || inRange(value.yawAngleDeg, -180, 180))
    && inRange(value.gimbalPitchDeg, -90, 24)
    && (value.sport === undefined || typeof value.sport === "boolean")
    && (value.shutter === undefined || value.shutter === 1)
    && (value.capture360 === undefined || typeof value.capture360 === "boolean");
}
/**
 * What the camera trackpad did since the last frame, not where it is: `yaw` and
 * `pitch` are the swipe as a fraction of the pad, and `zoom` is the ratio a
 * pinch changed the finger spread by. Deltas rather than a held rate, because a
 * trackpad is 1:1 with the finger — the host turns a fraction of a pad into an
 * angle with its own sensitivity, the way it already does for a mouse drag, and
 * neither end has to agree on a frame rate for the gesture to land.
 *
 * A dropped frame therefore costs that frame's movement rather than desyncing
 * anything, which is the right failure for a camera on an unreliable channel.
 *
 * Additive on v1, like `gearDown` and `feedback`: a frame without it moves no
 * camera, so a peer that never sends one behaves exactly as before.
 */
export interface CameraAim { yaw: number; pitch: number; zoom?: number }
/** A pinch cannot more than double or halve the view in one frame. */
export const MIN_CAMERA_ZOOM_STEP = 0.5;
export const MAX_CAMERA_ZOOM_STEP = 2;
export const NEUTRAL_CAMERA_AIM: CameraAim = { yaw: 0, pitch: 0 };
export function isCameraAim(value: unknown): value is CameraAim {
  if (!record(value)) return false;
  if (!["yaw", "pitch"].every(key => finite(value[key]) && Math.abs(value[key] as number) <= 1)) return false;
  return value.zoom === undefined
    || (finite(value.zoom) && value.zoom >= MIN_CAMERA_ZOOM_STEP && value.zoom <= MAX_CAMERA_ZOOM_STEP);
}
export function isAiming(aim: CameraAim | undefined): boolean {
  return Boolean(aim && (aim.yaw !== 0 || aim.pitch !== 0 || (aim.zoom !== undefined && aim.zoom !== 1)));
}

/**
 * The camera gesture so far rather than since the last frame: the sum of every
 * swipe this control epoch (`yaw`, `pitch`, in the same units as `CameraAim`),
 * the natural log of every pinch ratio multiplied together (`zoom`), and the
 * phone time the total is valid as of (`t`, its `performance.now()` — the
 * newest touch the total includes, or when the frame was built if the finger
 * has not moved since). A receiver draws the difference from the total it
 * last drew, so a lost frame costs nothing: any later one carries its movement.
 * `t` lets it draw on the phone's timeline instead of on arrival.
 *
 * Additive on v1 beside `camera`, which a phone keeps sending for hosts that
 * predate this. Never a control: it cannot refresh a lease or take authority.
 *
 * `down` is how many fingers are on the camera pad as of `t`, so the receiver
 * glides a swipe or pinch on when they lift and stops the glide when one
 * lands. Additive on v1: a phone that predates it sends none, and the receiver
 * then ends a gesture once its movement has been quiet. An older receiver
 * ignores it.
 */
export interface CameraTotal { yaw: number; pitch: number; zoom: number; t: number; down?: number }
/** A billion pixels of swiping: far beyond any flight, and still exact in a double. */
export const MAX_CAMERA_TOTAL = 1e6;
/** More fingers than a camera pad can tell apart. */
export const MAX_CAMERA_FINGERS = 10;
export function isCameraTotal(value: unknown): value is CameraTotal {
  return record(value) && ["yaw", "pitch", "zoom"].every(key => finite(value[key]) && Math.abs(value[key] as number) <= MAX_CAMERA_TOTAL)
    && finite(value.t);
}
/**
 * When the phone sends control frames. `timer` (the original, and what a
 * heartbeat without the field means): on each input event, at most 120 a
 * second, plus a 60 Hz timer. `batch`: once after each batch of touch events.
 * Chosen on the computer, which is where the A/B settings live.
 */
export type ControlSendMode = "timer" | "batch";

/**
 * Opt-in measurement, never control. A desktop opened with
 * `?phoneCameraTrace=1` puts `trace: 1` on its heartbeat, and a phone that
 * understands it attaches this to each control frame: when the frame was built,
 * what sent it, and the pointer events folded into it, all on the phone's own
 * clock. Additive on v1 like `camera`: an older desktop ignores the key, an
 * older phone never sends it, and a malformed one is dropped on its own. It
 * cannot move the camera, refresh a lease or take authority.
 */
export interface ControlTrace {
  /** Phone `performance.now()` when the frame was built. */
  at: number;
  /** What sent it: 0 an input event, 1 the control timer, 2 anything else. */
  by: 0 | 1 | 2;
  /** Send attempts the 120/s cap turned away since the previous frame. */
  gated: number;
  /** Control-channel bytes already buffered when it was queued. */
  buf: number;
  /**
   * Camera pointer events folded in: [ms since event.timeStamp, ms since its
   * handler ran, dx px, dy px, coalesced samples]. Ages before `at`, not
   * timestamps, to keep a traced frame small.
   */
  cam: number[][];
  /** Other control input events since the previous frame: [ms since event.timeStamp, ms since its handler ran]. */
  ctl: number[][];
  /** Frames the transport discarded unsent since the previous one: [count, camera dx px, camera dy px]. */
  drop: number[];
}
/** Per list, so a traced frame stays far below `MAX_MESSAGE_BYTES`. */
export const MAX_TRACE_EVENTS = 8;
export function isControlTrace(value: unknown): value is ControlTrace {
  const tuples = (list: unknown, width: number) => Array.isArray(list) && list.length <= MAX_TRACE_EVENTS
    && list.every(item => Array.isArray(item) && item.length === width && item.every(finite));
  return record(value) && finite(value.at) && (value.by === 0 || value.by === 1 || value.by === 2)
    && isCounter(value.gated) && finite(value.buf) && value.buf >= 0
    && tuples(value.cam, 5) && tuples(value.ctl, 2)
    && Array.isArray(value.drop) && value.drop.length === 3 && value.drop.every(finite);
}

/**
 * The phone controller's own settings. They are kept on the computer with its
 * other settings (Remote Control → Phone controller), so one export or preset
 * holds the whole setup; the phone keeps a copy for when it is not paired.
 */
export interface PhoneControllerSettings {
  /** Where the chip grid sits: under the flight controls, or over them. */
  grid: "bottom" | "top";
  /** What the yaw slider does when the finger leaves it: back to centre, or stay. */
  yawRelease: "center" | "hold";
  /** With `center`, how long the return takes; 0 snaps back. */
  yawReturnMs: number;
  /** Touchdown pulses, where the phone's browser can vibrate. */
  haptics: boolean;
  /**
   * The pitch/roll pad draws the flight's attitude indicator, from the
   * computer's `AttitudeMessage`s; false keeps the plain pad. Additive on v1:
   * settings without it are read as on, the default.
   */
  attitude: boolean;
  /**
   * What a press on a slider's track does: `jump` moves the handle to the
   * finger, `grab` moves it only when the press is on the handle, and then by
   * as much as the finger moves. Additive on v1 like `attitude`.
   */
  sliders: "jump" | "grab";
  /**
   * What two fingers do on the camera pad: `both` turns the view with the
   * point between them as they move and zooms as they spread, at once;
   * `zoom` only zooms. Additive on v1: settings without it are read as
   * `both`, the default.
   */
  twoFingers: "both" | "zoom";
}
export const MAX_YAW_RETURN_MS = 1500;
/** Settings from a peer that predates `attitude`, `sliders` or `twoFingers` lack them; they are read with their defaults. */
export function isPhoneControllerSettings(value: unknown): value is PhoneControllerSettings {
  if (!(record(value) && (value.grid === "bottom" || value.grid === "top")
    && (value.yawRelease === "center" || value.yawRelease === "hold")
    && finite(value.yawReturnMs) && value.yawReturnMs >= 0 && value.yawReturnMs <= MAX_YAW_RETURN_MS
    && typeof value.haptics === "boolean"
    && (value.attitude === undefined || typeof value.attitude === "boolean")
    && (value.sliders === undefined || value.sliders === "jump" || value.sliders === "grab")
    && (value.twoFingers === undefined || value.twoFingers === "both" || value.twoFingers === "zoom"))) return false;
  value.attitude ??= true;
  value.sliders ??= "jump";
  value.twoFingers ??= "both";
  return true;
}

/**
 * What the phone's attitude indicator draws: the aircraft's attitude and
 * velocity as the flight's own instrument reads them, the stick it shows while
 * no finger holds the phone's (`aileron`, `elevator`, where the controls are),
 * and `view`, the frame it is drawn from — the 3D camera's forward, right and
 * down in local north/east/down, row-major — when Renderer → Instruments →
 * Attitude indicator view is Camera; absent, it is drawn from the aircraft.
 * `readings` are what the pad writes on its corners.
 */
export interface PhoneAttitude {
  rollRad: number;
  pitchRad: number;
  headingRad: number;
  northVelocityFps: number;
  eastVelocityFps: number;
  verticalSpeedFps: number;
  aileron: number;
  elevator: number;
  view?: number[];
  readings?: PhoneAttitudeReadings;
}
/**
 * The readings the flight's Compact layout writes on its attitude indicator's
 * corners, which the phone's pad writes on its own; heading and vertical speed
 * come from the attitude itself. `altitudeFt` is above sea level, absent while
 * sea level there is unknown; `aoaDeg` is absent from an aircraft that reports
 * none. `tints` colour them as the flight's instrument bands do
 * (fly/src/flight/hud/instrumentBands.ts): airspeed and angle of attack 0
 * comfortable to 1 at the limit, vertical speed -1 descending to 1 climbing at
 * the aircraft's full scale, in steps of 5%; absent where the flight shows none.
 * Additive on v1: an older phone ignores them and keeps its chips.
 */
export interface PhoneAttitudeReadings {
  iasKt: number;
  altitudeFt?: number;
  aoaDeg?: number;
  tints?: { ias?: number; aoa?: number; vs?: number };
}
/**
 * Computer → phone on the unreliable channel, latest value only, as the
 * computer draws its frames and no faster than 60 a second, while the phone's
 * Attitude indicator setting is on. Not authority: it cannot refresh a lease.
 * Additive on v1: an older phone drops it, and a phone whose computer never
 * sends one keeps the plain pad.
 */
export type AttitudeMessage = Envelope & { type: "attitude"; attitude: PhoneAttitude };
/**
 * The attitude for the phone from what this computer's indicator draws,
 * rounded far below what the pad can show so that a frame stays short.
 */
export function phoneAttitude(
  state: Omit<PhoneAttitude, "aileron" | "elevator" | "view" | "readings">,
  stick: { aileron: number; elevator: number },
  view: readonly number[] | null,
  readings?: {
    iasKt: number; altitudeFt: number | null; aoaDeg: number | null;
    tints: { ias: number | null; aoa: number | null; vs: number | null };
  } | null,
): PhoneAttitude {
  // Divided rather than multiplied by a step, which would print 0.12350000000000001.
  const round = (value: number, per: number) => Math.round(value * per) / per;
  const fine = (value: number) => round(value, 1e4);
  // The pad writes whole knots and feet and tenths of a degree, as the flight does.
  const known = (value: number | null, per: number) => (value === null || !Number.isFinite(value) ? undefined : round(value, per));
  const tint = (value: number | null, min: number) => known(value === null ? null : Math.min(1, Math.max(min, value)), 20);
  const tints = readings && { ias: tint(readings.tints.ias, 0), aoa: tint(readings.tints.aoa, 0), vs: tint(readings.tints.vs, -1) };
  return {
    rollRad: fine(state.rollRad), pitchRad: fine(state.pitchRad), headingRad: fine(state.headingRad),
    northVelocityFps: round(state.northVelocityFps, 100), eastVelocityFps: round(state.eastVelocityFps, 100),
    verticalSpeedFps: round(state.verticalSpeedFps, 100),
    aileron: round(stick.aileron, 1e3), elevator: round(stick.elevator, 1e3),
    ...(view ? { view: view.map(fine) } : {}),
    ...(readings ? {
      readings: dropUndefined({
        iasKt: Math.round(readings.iasKt),
        altitudeFt: known(readings.altitudeFt, 1),
        aoaDeg: known(readings.aoaDeg, 10),
        tints: tints && Object.values(tints).some(value => value !== undefined) ? dropUndefined(tints) : undefined,
      }),
    } : {}),
  };
}
/** Leaves out what is unknown rather than sending it as null. */
function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
/** Far past any aircraft's speed, in ft/s, and still a short number on the wire. */
const MAX_ATTITUDE_SPEED_FPS = 1e5;
export function isPhoneAttitude(value: unknown): value is PhoneAttitude {
  if (!record(value)) return false;
  const angle = (key: string) => finite(value[key]) && Math.abs(value[key] as number) <= 4 * Math.PI;
  const speed = (key: string) => finite(value[key]) && Math.abs(value[key] as number) <= MAX_ATTITUDE_SPEED_FPS;
  const unit = (item: unknown) => finite(item) && Math.abs(item) <= 1.001;
  return ["rollRad", "pitchRad", "headingRad"].every(angle)
    && ["northVelocityFps", "eastVelocityFps", "verticalSpeedFps"].every(speed)
    && unit(value.aileron) && unit(value.elevator)
    && (value.view === undefined || (Array.isArray(value.view) && value.view.length === 9 && value.view.every(unit)))
    && (value.readings === undefined || isPhoneAttitudeReadings(value.readings));
}
function isPhoneAttitudeReadings(value: unknown): value is PhoneAttitudeReadings {
  if (!record(value)) return false;
  const within = (item: unknown, bound: number) => finite(item) && Math.abs(item) <= bound;
  const optional = (item: unknown, bound: number) => item === undefined || within(item, bound);
  const tints = value.tints;
  return within(value.iasKt, MAX_ATTITUDE_SPEED_FPS) && optional(value.altitudeFt, 1e7) && optional(value.aoaDeg, 180)
    && (tints === undefined || (record(tints) && optional(tints.ias, 1) && optional(tints.aoa, 1) && optional(tints.vs, 1)));
}
/**
 * The phone controller's settings, both ways on the reliable channel. The
 * phone sends its own once paired (`initial`: the computer takes them only
 * where it still has its defaults, so an imported setup wins and a phone's
 * existing choices are not lost) and again after each change its pilot makes.
 * The computer answers each with what it then holds, and sends them again
 * whenever they change there; it never sends them to a phone that has not
 * sent its own. `rev` counts the phone's sends: the computer's answer carries
 * the newest it has taken, and the phone ignores an answer older than its own
 * latest change, so a slider dragged on the phone is never pulled back by an
 * answer still in flight. Not authority, so not bound to an epoch. Additive on
 * v1: an older peer ignores the message, and each end keeps its own.
 */
export type PhoneSettingsMessage = Envelope & { type: "settings"; settings: PhoneControllerSettings; rev: number; initial?: true };

export interface Envelope { v: 1; session: string; epoch: number }
export type ActionName = "requestControl" | "releaseControl" | "setPriority" | "setPaused" | "setViewMode" | "setGearDown" | "setAutoFlaps" | "setPitchAutoTrim" | "setRollAutoTrim" | "shutdownEngine";
/**
 * `input: 1` when the pilot tapped for it, as on a control frame; one the
 * phone sends by itself, asking back control it lost or letting go as it
 * closes, has none. Additive on v1; an older host ignores it.
 */
export type ActionMessage = Envelope & {
  type: "action"; id: number; lease: number; action: ActionName; value?: boolean | "first" | "third" | "phone" | "computer";
  input?: 1;
};
/** Latest-value presentation cue; pulseMs 0 means stop now. Never a history of impacts. */
export interface HapticFeedbackFrame { v: 1; id: number; pulseMs: number; ttlMs: number }
/**
 * `starter: 1` while the phone holds its throttle lever to start the engine,
 * absent otherwise. A held control like the brake, not an action: it ends
 * when the frames that carry it stop, so a phone that drops off cannot leave
 * the starter turning. Additive on v1; an older host ignores it.
 *
 * `input: 1` when the pilot touched something on the phone since the previous
 * frame went out: a frame that only follows the computer's levers, or keeps
 * the stream alive, has none. Additive on v1; an older host ignores it.
 */
export type ControlFrame = Envelope & {
  type: "controls"; seq: number; lease: number; controls: ControlSurfaceState; camera?: CameraAim; aim?: CameraTotal; trace?: ControlTrace;
  starter?: 1; input?: 1;
  drone?: DroneCommand;
};
export type RemoteMessage =
  | { v: 1; type: "hello"; secret: string }
  | { v: 1; type: "reject"; reason: string }
  | (Envelope & { type: "welcome"; streamId: number; status: AircraftStatus })
  | (Envelope & { type: "ready" })
  | (Envelope & { type: "status"; status: AircraftStatus; message: string })
  | (Envelope & { type: "handoff"; controls: ControlSurfaceState; lease: number; requestId: number })
  | (Envelope & { type: "handoffAck"; requestId: number })
  /**
   * `resume`: taking control from this phone paused a running flight, and the
   * pause is this phone's to lift now that control is back, which a phone that
   * understands it does at once with `setPaused(false)`. The computer never
   * resumes by itself, so a flight cannot run under a phone that has not yet
   * heard it is flying. Additive on v1; an older phone keeps the pause.
   */
  | (Envelope & { type: "granted"; requestId: number; status: AircraftStatus; resume?: true })
  | ActionMessage
  | (Envelope & { type: "ack"; id: number; ok: boolean; message: string; status: AircraftStatus })
  | ControlFrame
  | (Envelope & { type: "heartbeat"; lease: number; status?: AircraftStatus; appliedSeq?: number; receiveToApplyMs?: number; feedback?: HapticFeedbackFrame; trace?: 1; controlSend?: ControlSendMode })
  | (Envelope & { type: "ping" | "pong"; id: number; sentAt: number })
  | AttitudeMessage
  | PhoneSettingsMessage;

export const NEUTRAL_CONTROLS: ControlSurfaceState = {
  elevator: 0, aileron: 0, rudder: 0, throttle: 0, pitchTrim: 0, rollTrim: 0, flaps: 0, brake: 0,
};
export function neutralize(controls: ControlSurfaceState): ControlSurfaceState {
  return { ...controls, elevator: 0, aileron: 0, rudder: 0, brake: 0 };
}
export function isCentered(controls: ControlSurfaceState): boolean {
  return Math.abs(controls.elevator) <= 0.03 && Math.abs(controls.aileron) <= 0.03
    && Math.abs(controls.rudder) <= 0.03 && controls.brake === 0;
}
export function isCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value: unknown, limit = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}
export function isControls(value: unknown): value is ControlSurfaceState {
  if (!record(value)) return false;
  return ["elevator", "aileron", "rudder", "pitchTrim", "rollTrim"].every(key => finite(value[key]) && Math.abs(value[key]) <= 1)
    && ["throttle", "flaps", "brake"].every(key => finite(value[key]) && value[key] >= 0 && value[key] <= 1);
}
function actualControlPositions(value: unknown): ActualControlPositions | undefined {
  if (!record(value)) return undefined;
  const result: ActualControlPositions = {};
  for (const key of ["throttle", "flaps", "rudder", "pitchTrim", "rollTrim"] as const) {
    const position = value[key];
    // Physical flaps can reflex above neutral even though their lever stops at zero.
    if (finite(position) && position >= (key === "throttle" ? 0 : -1) && position <= 1) result[key] = position;
  }
  return Object.keys(result).length ? result : undefined;
}
export function isHapticFeedback(value: unknown): value is HapticFeedbackFrame {
  return record(value) && value.v === HAPTIC_FEEDBACK_VERSION && isCounter(value.id)
    && Number.isInteger(value.pulseMs) && (value.pulseMs as number) >= 0 && (value.pulseMs as number) <= MAX_HAPTIC_PULSE_MS
    && Number.isInteger(value.ttlMs) && (value.ttlMs as number) > 0 && (value.ttlMs as number) <= HAPTIC_FEEDBACK_TTL_MS;
}
function isEngineOrbSettings(value: unknown): value is EngineOrbSettings {
  return record(value) && finite(value.fps) && value.fps >= 0 && value.fps <= 1000
    && finite(value.turnsPerSecond) && value.turnsPerSecond >= 0 && value.turnsPerSecond <= 4
    && (value.maxPatternStep === undefined || (finite(value.maxPatternStep) && value.maxPatternStep >= 0.05 && value.maxPatternStep <= 0.49))
    && finite(value.pixelRatio) && value.pixelRatio >= 1 && value.pixelRatio <= 3
    && ["auto", "webgpu", "webgl2", "webgl1", "off"].includes(value.renderer as string);
}

export function isEngineStatus(value: unknown): value is EngineStatus {
  if (!record(value)) return false;
  // A label, not free text: bounded and printable, because the phone renders it.
  if (typeof value.phase !== "string" || !/^[A-Z][A-Z ]{0,15}$/.test(value.phase)) return false;
  if (value.state !== undefined && !ENGINE_RUN_STATES.includes(value.state as EngineRunState)) return false;
  if (value.kind !== undefined && value.kind !== "piston" && value.kind !== "turbine") return false;
  if (value.afterburnerColor !== undefined
    && !(typeof value.afterburnerColor === "string" && /^#[0-9a-f]{6}$/i.test(value.afterburnerColor))) return false;
  if (value.rotorBlades !== undefined) {
    if (!record(value.rotorBlades)) return false;
    const blades = value.rotorBlades;
    const validCount = (count: unknown): boolean => finite(count) && Number.isInteger(count) && count >= 1 && count <= 128;
    if (!validCount(blades.outer) || !(blades.inner === null || validCount(blades.inner))
      || typeof blades.outerEstimated !== "boolean" || typeof blades.innerEstimated !== "boolean") return false;
  }
  if (value.simTimeS !== undefined && !(finite(value.simTimeS) && value.simTimeS >= 0)) return false;
  if (!["maxN1", "maxN2", "maxRpm"].every(key => value[key] === undefined || (finite(value[key]) && value[key] > 0))) return false;
  if (value.orbs !== undefined && !isEngineOrbSettings(value.orbs)) return false;
  if (value.start !== undefined && !(finite(value.start) && value.start >= 0 && value.start <= 1)) return false;
  // Shown on the phone as it comes: a short sentence, never markup.
  if (value.blocked !== undefined && !(typeof value.blocked === "string" && /^[A-Za-z0-9 ,.'-]{1,60}$/.test(value.blocked))) return false;
  return (["n1", "n2", "rpm", "thrustLbf", "fuelFlowPph", "fuelFlowGph"] as const)
    .every(key => value[key] === undefined || finite(value[key]));
}
function status(value: unknown): value is AircraftStatus {
  const valid = record(value) && (value.owner === "local" || value.owner === "phone")
    && typeof value.paused === "boolean" && (value.viewMode === "first" || value.viewMode === "third")
    && isControls(value.controls) && finite(value.airspeedKts) && finite(value.altitudeFt) && finite(value.headingDeg)
    && (value.gearDown === undefined || typeof value.gearDown === "boolean")
    && (value.autoFlaps === undefined || typeof value.autoFlaps === "boolean")
    && (value.autoTrim === undefined || (record(value.autoTrim)
      && typeof value.autoTrim.pitch === "boolean" && typeof value.autoTrim.roll === "boolean"))
    && (value.throttleBrakeRange === undefined || typeof value.throttleBrakeRange === "boolean")
    && (value.keepSliderBrakes === undefined || typeof value.keepSliderBrakes === "boolean")
    && (value.afterburnerDetent === undefined || (finite(value.afterburnerDetent) && value.afterburnerDetent >= 0 && value.afterburnerDetent <= 1))
    && (value.engine === undefined || isEngineStatus(value.engine));
  if (valid && value.drone !== undefined && !isDroneAvailability(value.drone) && !isDroneTelemetry(value.drone)) delete value.drone;
  if (valid && value.droneMotors !== undefined && !isDroneMotorStatus(value.droneMotors)) delete value.droneMotors;
  if (valid && value.controlCapabilities !== undefined && !isControlCapabilities(value.controlCapabilities)) delete value.controlCapabilities;
  // An offer, never authority: a malformed one is dropped on its own, and the
  // phone then simply waits to be asked, as it would from an older computer.
  if (valid && value.handBack !== undefined && value.handBack !== "now" && value.handBack !== "idle") delete value.handBack;
  if (valid && value.blend !== undefined && value.blend !== "phone" && value.blend !== "computer") delete value.blend;
  if (valid && value.actualControls !== undefined) {
    const positions = actualControlPositions(value.actualControls);
    if (positions) value.actualControls = positions;
    else delete value.actualControls;
  }
  return valid;
}

function parseBoundedRecord(input: unknown): Record<string, unknown> | null {
  let value: unknown;
  try {
    const encoded = typeof input === "string" ? input : JSON.stringify(input);
    if (typeof encoded !== "string" || encoded.length > MAX_MESSAGE_BYTES
      || new TextEncoder().encode(encoded).length > MAX_MESSAGE_BYTES) return null;
    value = JSON.parse(encoded);
  } catch { return null; }
  return record(value) ? value : null;
}

/** Classifies a bounded version envelope only; never accepts its controls or authority. */
export function isProtocolVersionMismatch(input: unknown): boolean {
  const value = parseBoundedRecord(input);
  return Boolean(value && isCounter(value.v) && value.v !== PROTOCOL_VERSION && boundedString(value.type, 64));
}

/** All network inputs are bounded before validation; rejected frames never refresh a lease. */
export function parseMessage(input: unknown): RemoteMessage | null {
  const value = parseBoundedRecord(input);
  if (!value || value.v !== PROTOCOL_VERSION) return null;
  if (value.type === "hello") return typeof value.secret === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.secret) ? value as RemoteMessage : null;
  if (value.type === "reject") return boundedString(value.reason) ? value as RemoteMessage : null;
  if (!boundedString(value.session, 128) || !isCounter(value.epoch)) return null;
  let valid = false;
  switch (value.type) {
    case "ready": valid = true; break;
    case "welcome": valid = isCounter(value.streamId) && value.streamId <= 65534 && status(value.status); break;
    case "status": valid = status(value.status) && boundedString(value.message); break;
    case "handoff": valid = isControls(value.controls) && isCounter(value.lease) && isCounter(value.requestId); break;
    case "handoffAck": valid = isCounter(value.requestId); break;
    case "granted": valid = isCounter(value.requestId) && status(value.status);
      if (valid && value.resume !== undefined && value.resume !== true) delete value.resume;
      break;
    case "ack": valid = isCounter(value.id) && typeof value.ok === "boolean" && boundedString(value.message) && status(value.status); break;
    case "controls":
      valid = isCounter(value.seq) && isCounter(value.lease) && isControls(value.controls);
      // The camera is a view, not a flight surface. Malformed aim is dropped on
      // its own rather than costing the frame its control surfaces.
      if (valid && value.camera !== undefined && !isCameraAim(value.camera)) delete value.camera;
      if (valid && value.aim !== undefined && !isCameraTotal(value.aim)) delete value.aim;
      if (valid && record(value.aim) && value.aim.down !== undefined && !(Number.isInteger(value.aim.down)
        && (value.aim.down as number) >= 0 && (value.aim.down as number) <= MAX_CAMERA_FINGERS)) delete value.aim.down;
      if (valid && value.trace !== undefined && !isControlTrace(value.trace)) delete value.trace;
      if (valid && value.starter !== undefined && value.starter !== 1) delete value.starter;
      if (valid && value.input !== undefined && value.input !== 1) delete value.input;
      if (valid && value.drone !== undefined && !isDroneCommand(value.drone)) delete value.drone;
      break;
    case "heartbeat": valid = isCounter(value.lease) && (value.status === undefined || status(value.status))
      && (value.appliedSeq === undefined || isCounter(value.appliedSeq))
      && (value.receiveToApplyMs === undefined || (finite(value.receiveToApplyMs) && value.receiveToApplyMs >= 0));
      // Unknown or malformed feedback is presentation-only: drop it, keep the lease.
      if (valid && value.feedback !== undefined && !isHapticFeedback(value.feedback)) delete value.feedback;
      if (valid && value.trace !== undefined && value.trace !== 1) delete value.trace;
      if (valid && value.controlSend !== undefined && value.controlSend !== "timer" && value.controlSend !== "batch") delete value.controlSend;
      break;
    case "ping": case "pong": valid = isCounter(value.id) && finite(value.sentAt) && value.sentAt >= 0; break;
    case "attitude": valid = isPhoneAttitude(value.attitude); break;
    case "settings": valid = isPhoneControllerSettings(value.settings) && isCounter(value.rev);
      if (valid && value.initial !== undefined && value.initial !== true) delete value.initial;
      break;
    case "action": valid = isCounter(value.id) && isCounter(value.lease) && (
      ((value.action === "requestControl" || value.action === "releaseControl" || value.action === "shutdownEngine") && value.value === undefined)
      || ((value.action === "setPaused" || value.action === "setGearDown" || value.action === "setAutoFlaps"
        || value.action === "setPitchAutoTrim" || value.action === "setRollAutoTrim") && typeof value.value === "boolean")
      || (value.action === "setViewMode" && (value.value === "first" || value.value === "third"))
      || (value.action === "setPriority" && (value.value === "phone" || value.value === "computer"))
    );
      if (valid && value.input !== undefined && value.input !== 1) delete value.input;
      break;
  }
  return valid ? value as RemoteMessage : null;
}
