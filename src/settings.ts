import type { ParameterSpec } from "foss-earth/settings";
import {
  catalogueDefaults,
  catalogueSpec,
  catalogueStore,
  type CatalogueParameters,
  type CatalogueRegistry,
  type CatalogueStore,
  type CatalogueValues,
} from "@0sfs/engines/parameterCatalogue";
import { MAX_YAW_RETURN_MS } from "./protocol";

/**
 * The phone remote control's flight parameters: its part of the flight's settings, with
 * their homes, section titles and defaults. The host composes the parts into
 * its catalogue in this order and registers them. Spec:
 * docs/proposals/flight-settings.md.
 */

const CAMERA = { tab: "aircraft", section: "camera" } as const;
const REMOTE_CONTROL = { tab: "remote", section: "control" } as const;
const PHONE_CAMERA = { tab: "remote", section: "camera" } as const;
const PHONE_CONTROLLER = { tab: "remote", section: "phone" } as const;

/** Section titles for the sections only the phone remote control's parameters are in, by tab and section id. */
export const REMOTE_CONTROL_SECTION_TITLES: readonly (readonly [tab: string, section: string, title: string])[] = [
  ["remote", "control", "Shared controls"],
  ["remote", "phone", "Phone controller"],
  ["remote", "camera", "Phone camera trackpad"],
];

const main = <T extends { tab: string; section: string }>(home: T) => ({ ...home, level: "main" as const });
const within = (min: number, max: number) => () => ({ min, max });

export const REMOTE_CONTROL_PARAMETERS = [
  {
    id: "osfs.camera.chaseFrame",
    label: "Camera follows",
    description: "Aircraft follows body rotation. Yaw follows aircraft heading with a smooth spring and a level horizon. Momentum follows the direction of travel with no roll and turns with the aircraft at hover. Planet keeps a level, north-oriented frame.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "aircraft", label: "Aircraft" },
      { id: "yaw", label: "Yaw" },
      { id: "momentum", label: "Momentum" },
      { id: "planet", label: "Planet" },
    ],
    legacyValues: [
      { value: "attitude", replacement: "aircraft" },
      { value: "no-roll", replacement: "momentum" },
      { value: "heading", replacement: "momentum" },
    ],
    default: "aircraft",
    defaultReason: "The original chase camera, which rides on the aircraft.",
    home: main(CAMERA),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },

  // Take control changes input priority. Both devices remain active; old
  // exclusive/handover/hold settings are no longer registered or read.
  {
    id: "osfs.remote.blendPriority",
    label: "Control priority",
    description: "Both devices can fly. Take control on either screen gives that device priority when inputs conflict. Typing or moving controls does not change priority. A phone leaves only after more than five seconds without valid input, a connection failure, or an explicit disconnect.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "phone", label: "Phone", description: "The phone has priority; this computer's input fills in around it." },
      { id: "computer", label: "This computer", description: "This computer has priority; the phone stays active and fills in around it." },
    ],
    default: "phone",
    defaultReason: "Taking control on the remote gives the phone priority without disabling the host's input.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "rc/src/controlBlend.ts",
  },
  {
    id: "osfs.remote.hostFlightUi",
    label: "Flight UI on this computer while a phone is connected",
    description: "Off, a connected phone has the flight's instruments and controls, and this computer shows only the view, the toolbar and its windows. They come back here while the phone stops answering, and when a key is pressed here, until the phone is touched again. On, both screens show them.",
    unit: "none",
    kind: "boolean",
    default: false,
    defaultReason: "The phone is the flight's instruments and controls while it is connected, so the view here is left clear.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },

  // Remote Control → Phone camera trackpad: how a phone's swipe reaches the
  // view. Smooth by default; docs/phone-controller.md → Camera trackpad.
  {
    id: "osfs.camera.phone.send",
    label: "Phone sends",
    description: "When the phone sends a control frame. A phone that loaded before this setting existed needs a fresh QR.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "timer", label: "On each touch, and a 60 Hz timer", description: "At most 120 a second; the original." },
      { id: "batch", label: "Once per touch frame", description: "About 10–17 ms sooner, and steadier." },
    ],
    default: "batch",
    defaultReason: "Sooner and steadier than the original, which loses on both counts.",
    home: main(PHONE_CAMERA),
    appliesLive: true,
    source: "rc/src/createPhoneControlSession.ts",
  },
  {
    id: "osfs.camera.phone.source",
    label: "Lost or late frames",
    description: "Whether a lost frame's movement is lost, or recovered from the gesture's running total.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "delta", label: "Lose their movement", description: "The original." },
      { id: "total", label: "Recover it from the running total", description: "No delay." },
    ],
    default: "total",
    defaultReason: "A lost frame then costs nothing, at no delay.",
    home: main(PHONE_CAMERA),
    appliesLive: true,
    source: "rc/src/phoneCameraPlayout.ts",
  },
  {
    id: "osfs.camera.phone.present",
    label: "Draw movement",
    description: "Whether arrived movement is drawn at once, or paced on the phone's own timeline.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "arrival", label: "As soon as it arrives", description: "The lowest delay, but uneven arrival over Wi-Fi shows as jumps. The original." },
      { id: "playout", label: "Paced on the phone's timeline", description: "Adds the playout buffer, and smooths stalls." },
    ],
    default: "playout",
    defaultReason: "Smooth first: drawn as it arrives, the camera jumps with every uneven delivery, which costs more than the playout buffer's delay. The lowest delay is the opt-in.",
    home: main(PHONE_CAMERA),
    appliesLive: true,
    source: "rc/src/phoneCameraPlayout.ts",
  },
  {
    id: "osfs.camera.phone.bufferMs",
    label: "Playout buffer",
    description: "With paced drawing, how far behind the fastest delivery seen movement is drawn; 0 only smooths stalls.",
    unit: "ms",
    kind: "number",
    step: 1,
    bounds: within(0, 100),
    default: 12,
    defaultReason: "The measured recommendation; 16 ms is smooth on a 120 Hz display.",
    home: main(PHONE_CAMERA),
    appliesLive: true,
    source: "rc/src/phoneCameraPlayout.ts",
  },
  {
    id: "osfs.camera.phone.catchUp",
    label: "Catch-up speed",
    description: "With paced drawing, the fastest a backlog is drawn after a stall, as a multiple of real speed.",
    unit: "ratio",
    kind: "number",
    step: 0.1,
    bounds: within(1, 8),
    named: [{ id: "jump", label: "Jump", description: "Draw the whole backlog at once, as arrival does." }],
    default: 2,
    defaultReason: "The measured recommendation.",
    home: main(PHONE_CAMERA),
    appliesLive: true,
    source: "rc/src/phoneCameraPlayout.ts",
  },
  {
    id: "osfs.camera.phone.predictMs",
    label: "Predict ahead",
    description: "With paced drawing, how far past the newest touch to extrapolate; it overshoots when the finger stops.",
    unit: "ms",
    kind: "number",
    step: 1,
    bounds: within(0, 50),
    default: 0,
    defaultReason: "Off: prediction guesses, and overshoots when the finger stops.",
    home: main(PHONE_CAMERA),
    appliesLive: true,
    source: "rc/src/phoneCameraPlayout.ts",
  },

  // Remote Control → Phone controller: the phone's own settings, which its ⚙
  // sheet and Haptics chip change over the link. Kept here so that one export
  // holds them; src/flight/remote/phoneControllerSettings.ts.
  {
    id: "osfs.phone.gridPosition",
    label: "Button grid",
    description: "Where the phone puts its instruments and buttons: under the flight controls, or over them.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "bottom", label: "Under the controls" },
      { id: "top", label: "Over the controls" },
    ],
    default: "bottom",
    defaultReason: "Where the grid has always been.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/PhoneController.tsx",
  },
  {
    id: "osfs.phone.yawRelease",
    label: "Yaw on release",
    description: "What the phone's yaw slider does when the finger leaves it.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "center", label: "Return to centre", description: "As a real rudder springs back." },
      { id: "hold", label: "Keep value", description: "For a long crosswind leg or a taxi turn, which a finger cannot hold on the track." },
    ],
    default: "center",
    defaultReason: "A deflection nobody is holding is how a phone flies into a slow spiral.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/PhoneYaw.tsx",
  },
  {
    id: "osfs.phone.yawReturnMs",
    label: "Yaw return time",
    description: "With Return to centre, how long the phone's rudder takes to get there; 0 snaps it back.",
    unit: "ms",
    kind: "number",
    step: 50,
    bounds: within(0, MAX_YAW_RETURN_MS),
    default: 0,
    defaultReason: "The instant release the controller has always done. A longer return eases the yaw the aircraft feels.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/PhoneYaw.tsx",
  },
  {
    id: "osfs.phone.haptics",
    label: "Phone haptics",
    description: "Touchdown pulses on the phone while it flies, where its browser can vibrate.",
    unit: "none",
    kind: "boolean",
    default: false,
    defaultReason: "A phone that buzzes in the hand should be one its pilot asked to.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/phoneControllerClient.ts",
  },
  {
    id: "osfs.phone.attitude",
    label: "Attitude indicator on the phone",
    description: "The phone's pitch/roll pad draws the flight's attitude indicator, as this computer's does. Off, it is a plain black pad with a crosshair.",
    unit: "none",
    kind: "boolean",
    default: true,
    defaultReason: "The pad is where this computer shows the attitude, and a phone flying the aircraft should show it too.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/PhoneStick.tsx",
  },
  {
    id: "osfs.phone.sliders",
    label: "Phone sliders",
    description: "What a press on one of the phone's sliders does: the handle jumps to the finger, or moves only when the press is on the handle.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "jump", label: "Jump to the finger", description: "A press anywhere on the track puts the handle there, and it follows the finger." },
      { id: "grab", label: "Grab the handle", description: "A press off the handle does nothing; on it, the handle moves as far as the finger does." },
    ],
    default: "jump",
    defaultReason: "A thumb lands where it means the lever to be, and a small handle is hard to hit on a moving phone.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/sliderPointer.ts",
  },
  {
    id: "osfs.phone.twoFingers",
    label: "Two fingers on the phone camera pad",
    description: "What two fingers on the phone's camera pad do: turn the view as they move and zoom as they spread, at once, or only zoom.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "both", label: "Orbit and zoom", description: "The view turns with the point between the fingers, as one finger turns it, while spreading or closing them zooms." },
      { id: "zoom", label: "Zoom only", description: "Two fingers only zoom, so a pinch never turns the view; one finger turns it." },
    ],
    default: "both",
    defaultReason: "As this computer's touchscreen does: two fingers turn the chase camera as they move and zoom it as they spread.",
    home: main(PHONE_CONTROLLER),
    appliesLive: true,
    source: "rc/src/PhoneStick.tsx",
  },
] as const satisfies readonly ParameterSpec[];

/** The effective value of each of the phone remote control's parameters, by id. */
export type RemoteControlParameterValues = CatalogueValues<typeof REMOTE_CONTROL_PARAMETERS>;

export type RemoteControlParameterId = keyof RemoteControlParameterValues & string;

/** What the phone remote control code reads its parameters through: the registry, or its defaults in a test. */
export type RemoteControlParameters = CatalogueParameters<RemoteControlParameterValues>;

/** Reads, writes and watches the phone remote control's parameters, typed by id. */
export type RemoteControlParameterStore = CatalogueStore<RemoteControlParameterValues>;

/** The registry, typed for the phone remote control's parameters. */
export function remoteControlParameterStore(registry: CatalogueRegistry): RemoteControlParameterStore {
  return catalogueStore(registry);
}

/** The spec of one of the phone remote control's parameters. */
export const remoteControlParameterSpec = catalogueSpec(REMOTE_CONTROL_PARAMETERS);

/**
 * The phone remote control's parameter defaults in memory, for code that runs without a
 * registry, such as a unit test. Overrides stand in for values the test sets.
 */
export function remoteControlParameterDefaults(overrides: Partial<RemoteControlParameterValues> = {}): RemoteControlParameterStore {
  return catalogueDefaults(remoteControlParameterSpec, overrides);
}
