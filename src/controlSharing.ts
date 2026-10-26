/** Shared flight input: Take control selects priority, never an exclusive owner. */
import {
  remoteControlParameterDefaults,
  type RemoteControlParameterId,
  type RemoteControlParameters,
} from "./settings";
import { PHONE_CONNECTION_LOSS_MS } from "./protocol";

/** Legacy values remain in the type for source compatibility, but are not read from saved settings. */
export type ControlHandover = "auto" | "stay" | "phone" | "computer";
export type ControlSharingMode = "exclusive" | "blend";
export type BlendPriority = "phone" | "computer";

export interface ControlSharing {
  /** Always blend for a live paired phone. */
  mode: ControlSharingMode;
  /** Legacy handover policies no longer revoke a phone on local input. */
  handover: ControlHandover;
  returnIdleMs: number;
  priority: BlendPriority;
  /** Total valid-input loss timeout, in milliseconds. */
  holdMs: number;
}

export const CONTROL_SHARING_PARAMETER_IDS: readonly RemoteControlParameterId[] = ["osfs.remote.blendPriority"];

export function readControlSharing(parameters: RemoteControlParameters): ControlSharing {
  // Ignore saved exclusive/automatic takeover and hold settings. A previous
  // preference cannot silently restore keyboard-triggered remote revocation.
  return {
    mode: "blend", handover: "phone", returnIdleMs: 0, holdMs: PHONE_CONNECTION_LOSS_MS,
    priority: parameters.get("osfs.remote.blendPriority"),
  };
}

export const DEFAULT_CONTROL_SHARING: Readonly<ControlSharing> = Object.freeze(readControlSharing(remoteControlParameterDefaults()));
