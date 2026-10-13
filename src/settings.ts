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
  ["remote", "control", "Who flies"],
  ["remote", "phone", "Phone controller"],
  ["remote", "camera", "Phone camera trackpad"],
];

const main = <T extends { tab: string; section: string }>(home: T) => ({ ...home, level: "main" as const });
const within = (min: number, max: number) => () => ({ min, max });

export const REMOTE_CONTROL_PARAMETERS = [
  {
    id: "osfs.camera.chaseFrame",
    label: "Chase camera turns with",
    description: "Which of the aircraft's rotations every chase view follows.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "attitude", label: "Roll, pitch and heading" },
      { id: "no-roll", label: "Pitch and heading", description: "Wings level." },
      { id: "heading", label: "Heading only", description: "Horizon level." },
    ],
    default: "attitude",
    defaultReason: "The original chase camera, which rides on the aircraft.",
    home: main(CAMERA),
    appliesLive: true,
    source: "src/flight/createFlightSimApp.ts",
  },

  // Remote Control → Who flies: how control passes between a paired phone and
  // this computer. Spec: docs/proposals/phone-controller.md → Sharing the controls.
  {
    id: "osfs.remote.sharing",
    label: "Sharing the controls",
    description: "Whether one device flies at a time, or a phone that has taken control flies together with this computer.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "exclusive", label: "One device at a time", description: "Only the device with control moves the aircraft. Control changes hands says when it passes." },
      { id: "blend", label: "Blend both", description: "Both devices fly at once. Where both move a control, Blend priority wins and the other has what it leaves free; a lever goes where it was last moved." },
    ],
    default: "exclusive",
    defaultReason: "One pilot at a time, as the controller was designed; blending is for two pilots who mean to share.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "rc/src/createPhoneControlSession.ts",
  },
  {
    id: "osfs.remote.blendPriority",
    label: "Blend priority",
    description: "With Blend both: whose input wins where both devices move the same control. Full deflection on that device is all of the control.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "phone", label: "Phone", description: "The phone's input wins; this computer's fills in around it." },
      { id: "computer", label: "This computer", description: "This computer's input wins, as an instructor's would; the phone's fills in around it." },
    ],
    default: "phone",
    defaultReason: "The phone is the remote being flown; this computer's input fills in around it.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "rc/src/controlBlend.ts",
  },
  {
    id: "osfs.remote.handover",
    label: "Control changes hands",
    description: "Which device flies when both the phone and this computer could. Take control in this tab always takes it here on purpose.",
    unit: "none",
    kind: "choice",
    choices: [
      { id: "auto", label: "Automatically", description: "Flight input here takes control. It goes back to the phone as soon as these controls rest, this tab is showing and the phone is heard from." },
      { id: "stay", label: "Only when taken", description: "Whichever device has control keeps it until the other takes it: flight input here, or Take control on the phone." },
      { id: "phone", label: "Latched to the phone", description: "The phone flies whenever it is heard from. Flight input here does not take control from it." },
      { id: "computer", label: "Latched to this computer", description: "This computer flies. The phone cannot take control." },
    ],
    default: "auto",
    defaultReason: "A remote that has to be taken back by hand after every stray key, hidden tab or dropped frame cannot be flown.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "rc/src/createPhoneControlSession.ts",
  },
  {
    id: "osfs.remote.returnIdle",
    label: "Rest before returning",
    description: "With Automatically: how long this computer's flight controls must rest before control goes back to the phone.",
    unit: "s",
    kind: "number",
    step: 0.1,
    bounds: within(0, 10),
    default: 1,
    defaultReason: "Long enough that keys tapped here keep control between taps; short enough that a stray touch hands it straight back.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "rc/src/createPhoneControlSession.ts",
  },
  {
    id: "osfs.remote.holdLast",
    label: "Hold the phone's last command",
    description: "When the phone's input stops arriving, how long its last command stands — a held starter, stick or brake stays held — before they let go and control comes back here. This computer stalling does not count.",
    unit: "s",
    kind: "number",
    step: 0.1,
    bounds: within(0, 10),
    default: 2,
    defaultReason: "Rides out a Wi-Fi stall or a busy phone, so an engine start or a turn carries on through it; short enough that a phone that is really gone does not fly a deflected stick for long.",
    home: main(REMOTE_CONTROL),
    appliesLive: true,
    source: "rc/src/createPhoneControlSession.ts",
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
