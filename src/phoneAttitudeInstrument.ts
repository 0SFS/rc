import type { PhoneAttitude } from './protocol'

/** The stick the instrument draws: deflection -1..1 each way, y down; `active` shows it at rest too. */
export interface PhoneAttitudeStick { x: number; y: number; active: boolean }

/** One instrument, drawn into the pad it was mounted in. */
export interface PhoneAttitudeInstrument {
  draw(attitude: PhoneAttitude, stick: PhoneAttitudeStick): void
  destroy(): void
}

/**
 * The flight's attitude indicator for the phone's pitch/roll pad. The flight
 * app supplies it, as the renderer its own HUD draws with
 * (fly/src/flight/hud/phoneAttitude.ts), so the two screens show one
 * instrument; a phone page without it keeps the plain pad.
 */
export interface PhoneAttitudeRenderer {
  /** The instrument's half side as a share of the pad's side: full stick deflection, as on the flight's own pad. */
  halfShare: number
  mount(host: HTMLElement): PhoneAttitudeInstrument
}

/** Loads the renderer when the pad first needs it; the same promise each time. */
export type LoadPhoneAttitude = () => Promise<PhoneAttitudeRenderer>

/** The flight HUD's stick response and its inverse: what a stick at rest shows for the controls it has. */
export { stickResponse, inverseStickResponse } from '@0sfs/controls/centeredStick'
