// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
/** The camera has its own tests; here only what the controller hands it matters. */
const scanner = vi.hoisted(() => ({ props: null as null | { onScan(url: string): void; onClose(): void } }))
vi.mock('@0sfs/engines/engineSpoolRenderer', () => ({
  createEngineSpoolRenderer: () => ({ draw() {}, configure() {}, setAccentColor() {}, destroy() {}, canDraw: () => true,
    getMotionStatus: () => ({ fps: null, maxTurnsPerSecond: null, limited: false }), ready: Promise.resolve() }),
}))
vi.mock('../src/PhoneQrScanner', async () => {
  const { createElement } = await import('react')
  return { PhoneQrScanner: (props: { onScan(url: string): void; onClose(): void }) => {
    scanner.props = props
    return createElement('div', { className: 'phone-scanner' })
  } }
})
import { PhoneController } from '../src/PhoneController'
import { createConnectionLog } from '../src/connectionDiagnostics'
import { NEUTRAL_CONTROLS, type AircraftStatus, type EngineStatus, type PhoneAttitude, type PhoneControllerSettings } from '../src/protocol'
import type { LoadPhoneAttitude } from '../src/phoneAttitudeInstrument'
import type { PhoneControllerClient, PhoneControllerSnapshot } from '../src/phoneControllerClient'
import { DEFAULT_PHONE_SETTINGS } from '../src/phoneSettingsStore'

let root: Root
let container: HTMLDivElement
let storage: Map<string, string>
const nudgeCamera = vi.fn()
const setCameraFingers = vi.fn()
const updateControls = vi.fn()
const updatePower = vi.fn()
const setPaused = vi.fn(() => true)
const setHapticsEnabled = vi.fn()
/** The client keeps the settings; this one keeps them the way it does, for the screen to follow. */
const updateSettings = vi.fn((patch: Partial<PhoneControllerSettings>) => {
  state = { ...state, settings: { ...state.settings, ...patch } }
  for (const listener of listeners) listener()
})
let state: PhoneControllerSnapshot
const listeners = new Set<() => void>()
const setViewMode = vi.fn(() => true)
const requestControl = vi.fn(() => true)
const setStarterHeld = vi.fn()
const shutdownEngine = vi.fn(() => true)
const setAutoFlaps = vi.fn(() => true)
const setAutoTrim = vi.fn(() => true)
const setDrone = vi.fn()

function mount({ engine, status, snapshot, onPair, loadAttitude, attitude = null }: {
  engine?: EngineStatus
  status?: Partial<AircraftStatus>
  snapshot?: Partial<PhoneControllerSnapshot>
  onPair?(url: string): void
  loadAttitude?: LoadPhoneAttitude
  attitude?: PhoneAttitude | null
} = {}): void {
  const aircraft: AircraftStatus = {
    owner: 'phone', paused: false, viewMode: 'third', controls: NEUTRAL_CONTROLS,
    airspeedKts: 148, altitudeFt: 4250, headingDeg: 271, gearDown: true, ...(engine ? { engine } : {}), ...status,
  }
  state = {
    phase: 'ready', message: 'Phone controls', status: aircraft, controls: { ...NEUTRAL_CONTROLS }, leverBrake: 0,
    canFly: false, canControl: true, requestingControl: false, hostFresh: true, lostMs: null, signalingAvailable: true,
    pendingActions: 0, rttMs: 20, sendHz: 120, diagnostics: null, appliedSeq: 1, receiveToApplyMs: 2,
    hapticsSupported: true, hapticsEnabled: false, settings: { ...DEFAULT_PHONE_SETTINGS }, ...snapshot,
  }
  const client: PhoneControllerClient = {
    log: createConnectionLog('phone', () => 0),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    updateControls, updatePower, nudgeCamera, setCameraFingers, cancelTransientControls: vi.fn(), requestControl,
    setPaused, setViewMode, setGearDown: () => true, setAutoFlaps, setAutoTrim, setStarterHeld, shutdownEngine, releaseControl: () => true, setPriority: () => true,
    setHapticsEnabled, updateSettings, destroy: vi.fn(),
    getAttitude: () => attitude, subscribeAttitude: () => () => {}, setDrone,
  }
  act(() => root.render(<PhoneController client={client} onPair={onPair} loadAttitude={loadAttitude} />))
}
const remount = (options?: Parameters<typeof mount>[0]) => {
  act(() => root.unmount())
  root = createRoot(container)
  mount(options)
}
const grid = () => container.querySelector('.phone-actions')!
const button = (label: string) => [...container.querySelectorAll('button')]
  .find(candidate => candidate.getAttribute('aria-label') === label || candidate.textContent === label)
const text = (selector: string) => container.querySelector(selector)?.textContent
/** jsdom has no PointerEvent; React delegates on the name alone. */
const pointer = (target: Element, type: string, detail: Record<string, number> = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, button: 0, ...detail })
  act(() => { target.dispatchEvent(event) })
}
/** React listens for `input`, so a range has to be moved the way a finger does. */
const drag = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const yawTrack = () => container.querySelector<HTMLInputElement>('.phone-yaw input[type="range"]')!
/** The box round the yaw range, which takes the finger; see sliderPointer.ts. */
const yawSurface = () => container.querySelector<HTMLElement>('.phone-yaw .flight-control-position')!
/** Where on the 200 px track (a 10 px thumb at each end) the yaw handle sits at this rudder. */
const yawAt = (rudder: number) => 5 + (rudder + 1) / 2 * 190
const yawReturn = () => updateControls.mock.calls.at(-1)![0].rudder as number

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
  nudgeCamera.mockClear()
  setCameraFingers.mockClear()
  updateControls.mockClear()
  updatePower.mockClear()
  setPaused.mockClear()
  setHapticsEnabled.mockClear()
  updateSettings.mockClear()
  listeners.clear()
  setViewMode.mockClear()
  requestControl.mockClear()
  setStarterHeld.mockClear()
  shutdownEngine.mockClear()
  setAutoFlaps.mockClear()
  setAutoTrim.mockClear()
  setDrone.mockClear()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) })
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('drone instrument controls', () => {
  it('embeds both instruments, keeps settings reachable, swaps only this phone and centers both sticks', async () => {
    const draw = vi.fn()
    const attitude: PhoneAttitude = { rollRad: 0, pitchRad: 0, headingRad: 0, northVelocityFps: 0, eastVelocityFps: 0, verticalSpeedFps: 0, aileron: 0, elevator: 0 }
    mount({ status: { drone: { available: true }, droneMotors: {
      aircraftId: 'dji-mini2', label: 'Mini 2', hoverRpm: 10000, maxRpm: 16000, simTimeS: 1, source: 'simulated',
      motors: [
        { position: 'front-left', rpm: 10001, direction: 1 }, { position: 'front-right', rpm: 10002, direction: -1 },
        { position: 'rear-left', rpm: 10003, direction: -1 }, { position: 'rear-right', rpm: 10004, direction: 1 },
      ],
    } }, attitude, loadAttitude: async () => ({ halfShare: 96 / 220, mount: () => ({ draw, destroy() {} }) }) })
    await act(async () => { await vi.dynamicImportSettled() })
    const motorPad = () => container.querySelector<HTMLElement>('.phone-stick--motors')!
    const pitchPad = () => container.querySelector<HTMLElement>('.phone-stick--drone-attitude')!
    expect(container.querySelector('.phone-drone__sticks')?.getAttribute('data-attitude-side')).toBe('right')
    expect(container.querySelector('.phone-stick--drone-attitude.phone-stick--attitude')).not.toBeNull()
    expect(motorPad().querySelectorAll('.flight-quad-engine__motor')).toHaveLength(4)
    expect(motorPad().querySelector('button')).toBeNull()
    expect(motorPad().textContent).toContain('10001')
    expect(button('G')).toBeUndefined()
    expect(container.querySelector('[aria-label="Pitch trim"]')).toBeNull()
    expect(container.querySelector('details.phone-settings')).not.toBeNull()
    pointer(motorPad(), 'pointerdown', { pointerId: 1, clientX: 200, clientY: 0 })
    pointer(pitchPad(), 'pointerdown', { pointerId: 2, clientX: 200, clientY: 0 })
    expect(setDrone.mock.lastCall?.[0]).toMatchObject({ yaw: 1, vertical: 1, roll: 1, pitch: 1 })
    const choices = container.querySelector('[aria-label="Drone pitch/roll side"]')!
    act(() => choices.querySelector<HTMLButtonElement>('button')!.click())
    expect(container.querySelector('.phone-drone__sticks')?.getAttribute('data-attitude-side')).toBe('left')
    expect(setDrone.mock.lastCall?.[0]).toMatchObject({ yaw: 0, vertical: 0, roll: 0, pitch: 0 })
    expect(updateSettings).not.toHaveBeenCalled()
    expect([...storage.values()]).toContain(JSON.stringify({ planeAttitudeSide: 'left', droneAttitudeSide: 'left' }))
    pointer(motorPad(), 'pointerdown', { pointerId: 3, clientX: 200, clientY: 0 })
    act(() => button('Air 2S')!.click())
    expect(setDrone.mock.lastCall?.[0]).toMatchObject({ droneId: 'dji-air2s', yaw: 0, vertical: 0, roll: 0, pitch: 0 })
    const fromHost = (droneId: 'dji-mini2' | 'dji-air2s') => act(() => {
      state = { ...state, status: { ...state.status!, drone: { available: true, droneId, yawAngleDeg: 0,
        gimbalPitchDeg: 0, gimbalRollDeg: 0, isSettled: true, isCapturing: false, capturePhase: 'idle',
        nodeIndex: 0, nodeCount: 0, flowConfidence: 0, flowSource: 'imu', omegaVisualRadPerSec: 0 } } }
      for (const listener of listeners) listener()
    })
    fromHost('dji-air2s')
    expect(button('Air 2S')?.getAttribute('aria-pressed')).toBe('true')
    pointer(motorPad(), 'pointerdown', { pointerId: 4, clientX: 200, clientY: 0 })
    fromHost('dji-mini2')
    expect(button('Mini 2')?.getAttribute('aria-pressed')).toBe('true')
    expect(setDrone.mock.lastCall?.[0]).toMatchObject({ droneId: 'dji-mini2', yaw: 0, vertical: 0, roll: 0, pitch: 0 })
  })
})

describe('phone controller screen', () => {
  it('shows physical travel without replacing or sending the phone command', () => {
    mount({ status: { actualControls: { flaps: .2, rudder: -.3, throttle: .4 } }, snapshot: {
      controls: { ...NEUTRAL_CONTROLS, flaps: .8, rudder: .5, throttle: .9 },
    } })
    const flaps = container.querySelector<HTMLInputElement>('input[aria-label="Flaps"]')!
    const marker = flaps.parentElement!.querySelector<HTMLElement>('.flight-control-position__actual')!
    expect(flaps.value).toBe('0.8')
    expect(marker.hidden).toBe(false)
    expect(flaps.getAttribute('aria-valuetext')).toBe('80% commanded; 20% actual')
    expect(yawTrack().value).toBe('0.5')
    expect(yawTrack().getAttribute('aria-valuetext')).toBe('50% commanded; -30% actual')
    expect(container.querySelector('[data-control="throttle"]')!.getAttribute('aria-valuetext')).toContain('90% commanded throttle; 40% actual throttle')
    act(() => {
      state = { ...state, status: { ...state.status!, actualControls: { flaps: .6, rudder: -.1, throttle: .7 } } }
      for (const listener of listeners) listener()
    })
    expect(flaps.value).toBe('0.8')
    expect(flaps.parentElement!.style.getPropertyValue('--control-actual')).toBe('0.6')
    expect(updateControls).not.toHaveBeenCalled()
    expect(updatePower).not.toHaveBeenCalled()
  })

  it('draws the desktop engine widget over the throttle, not engine chips in the grid', () => {
    mount({ engine: { phase: 'WINDMILLING', n1: 12.5, n2: 30, fuelFlowPph: 0 } })
    const engine = container.querySelector('.phone-yaw-throttle--engine > .phone-engine')!
    expect(engine.querySelector('.flight-engine__phase')?.textContent).toBe('WINDMILLING')
    // The id the desktop colours by, recovered from the label that travelled.
    expect(engine.querySelector<HTMLElement>('.flight-engine__phase')?.dataset.phase).toBe('windmilling')
    expect(engine.querySelector('.flight-engine__spool-n1 .flight-engine__spool-value')?.textContent).toBe('12.5')
    // Zero is a reading, and it prints as one.
    expect(engine.querySelector('.flight-engine__flow-value')?.textContent).toBe('0000')
    // No engine tapes: the grid has instruments the widget does not draw.
    const labels = [...grid().querySelectorAll('.flight-hud__label')].map(label => label.textContent)
    expect(labels).toEqual(['IAS', 'ALT', 'HDG'])
  })

  it('switches fuel flow units on a tap, and remembers the choice', () => {
    mount({ engine: { phase: 'RUNNING', n1: 72.4, n2: 88.1, fuelFlowPph: 412, fuelFlowGph: 61.5 } })
    act(() => { container.querySelector<HTMLElement>('.flight-engine__flow')!.click() })
    expect(text('.flight-engine__flow-value')).toBe('0062')
    expect(text('.flight-engine__flow-unit')).toBe('gal/h')
    remount({ engine: { phase: 'RUNNING', fuelFlowPph: 412 } })
    // No volume flow from this host: the widget converts, as the desktop does.
    expect(text('.flight-engine__flow-value')).toBe('0061')
  })

  it('keeps a phase label it does not know, uncoloured, and gives the throttle the column with no engine', () => {
    mount({ engine: { phase: 'FLAMED OUT' } })
    const phase = container.querySelector<HTMLElement>('.flight-engine__phase')!
    expect(phase.textContent).toBe('FLAMED OUT')
    expect(phase.dataset.phase).toBeUndefined()
    remount()
    expect(container.querySelector('.phone-engine')).toBeNull()
    expect(container.querySelector('.phone-yaw-throttle--engine')).toBeNull()
  })

  it('draws the desktop throttle lever, and holding it while the engine is off holds the starter', () => {
    mount({ engine: { phase: 'OFF', state: 'stopped', start: 0 }, snapshot: { controls: { ...NEUTRAL_CONTROLS, throttle: 0.4 } } })
    const lever = container.querySelector<HTMLElement>('.phone-yaw-throttle > .flight-hud__slider-control--throttle.phone-throttle')!
    const slider = lever.querySelector<HTMLElement>('[data-control="throttle"][role="slider"]')!
    expect(lever.dataset.engine).toBe('stopped')
    expect(lever.querySelector('output')!.value).toBe('OFF')
    // Engine off, the throttle this phone sends rests at idle with the lever.
    expect(updateControls).toHaveBeenCalledWith({ throttle: 0 })
    pointer(slider, 'pointerdown', { clientY: 100 })
    expect(setStarterHeld).toHaveBeenLastCalledWith(true)
    expect(lever.dataset.hold).toBe('start')
    pointer(slider, 'pointerup', { clientY: 100 })
    expect(setStarterHeld).toHaveBeenLastCalledWith(false)
  })

  it('rings the lever at idle and asks the computer to shut the engine down when the ring closes', () => {
    vi.useFakeTimers()
    try {
      mount({ engine: { phase: 'RUNNING', state: 'running', start: 1 } })
      const slider = container.querySelector<HTMLElement>('.phone-throttle [data-control="throttle"]')!
      pointer(slider, 'pointerdown', { clientY: 100 })
      act(() => { vi.advanceTimersByTime(1500) })
      expect(shutdownEngine).toHaveBeenCalledOnce()
      expect(setStarterHeld).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('is a plain throttle for a host that cannot start or stop the engine', () => {
    mount({ engine: { phase: 'RUNNING' } })
    const lever = container.querySelector<HTMLElement>('.phone-throttle')!
    expect(lever.dataset.engine).toBeUndefined()
    const slider = lever.querySelector<HTMLElement>('[data-control="throttle"]')!
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })) })
    expect(updateControls).toHaveBeenLastCalledWith({ throttle: 0.1 })
  })

  it('uses the host combined lever capability and draws the selected lever brake independently of the hold button', () => {
    mount({ status: { throttleBrakeRange: true },
      snapshot: { controls: { ...NEUTRAL_CONTROLS, brake: 1 }, leverBrake: .4 } })
    const lever = container.querySelector<HTMLElement>('.phone-throttle')!
    expect(lever.querySelector('span')?.textContent).toBe('BRK')
    expect(lever.querySelector('output')?.value).toBe('40%')
    const slider = lever.querySelector<HTMLElement>('[data-control="throttle"]')!
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 0, brake: 1 })
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 1, brake: 0 })
    // A later host capability change restores a conventional throttle.
    act(() => {
      state = { ...state, status: { ...state.status!, throttleBrakeRange: false } }
      for (const listener of listeners) listener()
    })
    updatePower.mockClear()
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(updateControls).toHaveBeenLastCalledWith({ throttle: 0 })
    expect(updatePower).not.toHaveBeenCalled()
  })

  it.each([undefined, false, true])('uses the host keepSliderBrakes=%s setting for pointer and key release', keepSliderBrakes => {
    mount({ status: { throttleBrakeRange: true, keepSliderBrakes } })
    const slider = container.querySelector<HTMLElement>('.phone-throttle [data-control="throttle"]')!
    pointer(slider, 'pointerdown', { clientY: 200 })
    pointer(slider, 'pointermove', { clientY: 201 })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 0, brake: 1 })
    pointer(slider, 'pointerup', { clientY: 201 })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 0, brake: keepSliderBrakes ? 1 : 0 })
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 0, brake: 1 })
    act(() => { slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', bubbles: true })) })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 0, brake: keepSliderBrakes ? 1 : 0 })
  })

  it.each([undefined, 0.99])('stops one push of the throttle at the host afterburner detent %s', afterburnerDetent => {
    mount({ status: { throttleBrakeRange: true, afterburnerDetent } })
    const slider = container.querySelector<HTMLElement>('.phone-throttle [data-control="throttle"]')!
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: afterburnerDetent ?? 1, brake: 0 })
    act(() => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
    expect(updatePower).toHaveBeenLastCalledWith({ throttle: 1, brake: 0 })
  })

  it('puts nothing above the controls for a lost link: the 🌐 chip counts how long, and the controls stay live', () => {
    mount({ snapshot: { hostFresh: false, lostMs: 1200, message: 'Connection lost · Waiting for the computer' } })
    // jsdom offers no fullscreen, so no popup either: the controls are the page.
    expect([...container.querySelector('main')!.children].map(child => child.className))
      .toEqual(['phone-controls phone-controls--grid-bottom'])
    const link = container.querySelector('.phone-link')!
    expect(link.classList.contains('phone-link--live')).toBe(false)
    // Who flies has not changed: the computer holds this phone's last command.
    expect(link.firstChild?.nextSibling?.textContent).toBe('Phone priority')
    // Still said, to assistive tech.
    expect(link.querySelector('[role="status"]')?.textContent).toBe('Connection lost · Waiting for the computer')
    expect(text('.phone-diagnostics .phone-sheet__chip')).toBe('🌐 1.2s')
    expect(container.querySelector('.phone-diagnostics__lost')).not.toBeNull()
    expect(text('.phone-diagnostics .phone-sheet__title')).toBe('Connection details · lost for 1.2 s')
    expect(button('Take control')?.disabled).toBe(false)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Pitch trim"]')?.disabled).toBe(false)
    // Heard again, the round trip is back.
    remount()
    expect(text('.phone-diagnostics .phone-sheet__chip')).toBe('🌐 20ms')
    expect(container.querySelector('.phone-diagnostics__lost')).toBeNull()
  })

  it('names priority while both devices keep control and lets this phone take priority', () => {
    const chip = () => container.querySelector('.phone-link')!.firstChild?.nextSibling?.textContent
    mount()
    expect(chip()).toBe('Phone priority')
    expect(button('Take control')?.getAttribute('aria-pressed')).toBe('true')
    remount({ status: { owner: 'phone', blend: 'computer' } })
    expect(chip()).toBe('Computer priority')
    expect(button('Take control')?.disabled).toBe(false)
    expect(button('Take control')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Flaps"]')?.disabled).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('.phone-stick')?.disabled).toBe(false)
    expect(container.querySelector<HTMLElement>('.phone-throttle [data-control="throttle"]')?.getAttribute('aria-disabled')).toBe('false')
    act(() => { button('Take control')!.click() })
    expect(requestControl).toHaveBeenCalledOnce()
    remount({ status: { owner: 'local' }, snapshot: { canFly: true, canControl: false } })
    expect(chip()).toBe('Computer')
  })

  it('lays the grid out instruments first, then the buttons, with the brake last', () => {
    mount()
    const describe = (child: Element) => child.querySelector('.flight-hud__label')?.textContent
      ?? (child.matches('.phone-sheet') ? child.className : child.getAttribute('aria-label') ?? child.textContent)
    expect([...grid().children].map(describe)).toEqual([
      'IAS', 'ALT', 'HDG', 'G', expect.stringContaining('Phone priority'), 'Pause simulation', 'Take control',
      'Haptics', 'phone-sheet phone-diagnostics', '120Hz120 control frames a second', 'phone-sheet phone-settings',
      'phone-sheet phone-browser-data', expect.stringContaining('brake'),
    ])
    expect(text('.phone-diagnostics .phone-sheet__chip')).toBe('🌐 20ms')
  })

  it('shows how often this phone sends right of the round trip, at one width', () => {
    mount({ snapshot: { sendHz: 60 } })
    const rate = container.querySelector('.phone-diagnostics + .phone-rate')!
    expect(rate.querySelector('.phone-rate__reading')?.textContent).toBe('60Hz')
    expect(rate.querySelector('.phone-sr-only')?.textContent).toBe('60 control frames a second')
    expect(text('.phone-diagnostics dl')).toContain('Control frames sent60 a second')
    remount({ snapshot: { phase: 'connecting', sendHz: null } })
    expect(text('.phone-rate__reading')).toBe('—')
  })

  it('keeps Take control in the chip grid before and after joining shared controls', () => {
    mount({ status: { owner: 'local' }, snapshot: { canFly: true, canControl: false, message: 'Connected · Desktop controls' } })
    expect([...container.querySelector('main')!.children].map(child => child.className))
      .toEqual(['phone-controls phone-controls--grid-bottom'])
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    const take = button('Take control')!
    expect(take.parentElement).toBe(grid())
    act(() => { take.click() })
    expect(requestControl).toHaveBeenCalledOnce()
    expect(button('Pause simulation')).toBeUndefined()
    expect(button('Release')).toBeUndefined()
    // Why it cannot be taken goes with the chip, and to assistive tech.
    remount({ status: { owner: 'local' }, snapshot: { canFly: true, canControl: false, message: 'Center controls to take over.' } })
    expect(button('Take control')?.title).toBe('Center controls to take over.')
    remount({ status: { owner: 'local' }, snapshot: { canFly: false, canControl: false, requestingControl: true, message: 'Taking control…' } })
    expect(button('Taking control…')?.disabled).toBe(true)

    // Connecting, and over: nothing to take control with.
    remount({ status: { owner: 'local' }, snapshot: { phase: 'connecting', canFly: false, canControl: false, message: 'Opening direct control channel…' } })
    expect(button('Take control')).toBeUndefined()
    expect(container.querySelector('.phone-link')?.firstChild?.nextSibling?.textContent).toBe('PAIRING')
    remount({ snapshot: { phase: 'disconnected', canFly: false, canControl: false, message: 'The computer ended the session.' } })
    expect(button('Take control')).toBeUndefined()
    expect(container.querySelector('.phone-link')?.firstChild?.nextSibling?.textContent).toBe('OFFLINE')

    // Sharing: priority stays available beside Pause.
    remount()
    expect(button('Take control')?.disabled).toBe(false)
    expect(button('Pause simulation')).toBeDefined()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('offers the page\'s own QR scanner as the way back from an ended session', () => {
    const ended = { phase: 'disconnected', canFly: false, canControl: false, message: 'The computer ended the session.' } as const
    mount({ snapshot: ended })
    // Without a way to pair, there is nothing to scan into.
    expect(button('Scan QR code')).toBeUndefined()

    const onPair = vi.fn()
    remount({ snapshot: ended, onPair })
    expect(container.querySelector('.phone-scanner')).toBeNull()
    // A chip in the grid, where Take control was.
    expect(button('Scan QR code')?.parentElement).toBe(grid())
    act(() => { button('Scan QR code')!.click() })
    expect(container.querySelector('.phone-scanner')).not.toBeNull()
    act(() => { scanner.props!.onScan('https://0sfs.github.io/rc/#v=1&peer=d&join=s') })
    expect(onPair).toHaveBeenCalledWith('https://0sfs.github.io/rc/#v=1&peer=d&join=s')

    act(() => { scanner.props!.onClose() })
    expect(container.querySelector('.phone-scanner')).toBeNull()
    // A session in progress has no Scan button: that chip is for taking control.
    remount({ status: { owner: 'local' }, snapshot: { canFly: true, canControl: false }, onPair })
    expect(button('Scan QR code')).toBeUndefined()
    expect(button('Take control')).toBeDefined()
  })

  it('pauses with the flight page glyphs and toggles haptics from the grid', () => {
    mount()
    const pause = button('Pause simulation')!
    expect(pause.textContent).toBe('Ⅱ')
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    act(() => { pause.click() })
    expect(setPaused).toHaveBeenCalledWith(true)
    remount({ status: { paused: true } })
    const resume = button('Resume simulation')!
    expect(resume.textContent).toBe('▶')
    expect(resume.getAttribute('aria-pressed')).toBe('true')

    act(() => { button('Haptics')!.click() })
    expect(setHapticsEnabled).toHaveBeenCalledWith(true)
  })

  it('switches cockpit and chase from a switch in the camera pad corner, not the grid', () => {
    mount()
    const view = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(view.parentElement?.className).toBe('phone-camera-slot')
    // Beside the pad, never inside its button.
    expect(view.closest('.phone-camera')).toBeNull()
    expect(grid().querySelector('[role="switch"]')).toBeNull()
    // Chase is on, and the thumb is under the second icon.
    expect(view.getAttribute('aria-checked')).toBe('true')
    expect([...view.children].map(option => option.hasAttribute('data-selected'))).toEqual([false, true])
    act(() => { view.click() })
    expect(setViewMode).toHaveBeenLastCalledWith('first')
    remount({ status: { viewMode: 'first' } })
    const cockpit = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(cockpit.getAttribute('aria-checked')).toBe('false')
    expect([...cockpit.children].map(option => option.hasAttribute('data-selected'))).toEqual([true, false])
    act(() => { cockpit.click() })
    expect(setViewMode).toHaveBeenLastCalledWith('third')
  })

  it('moves the grid above the controls from Settings, through the client that keeps the settings', () => {
    mount()
    const top = container.querySelector<HTMLInputElement>('.phone-settings input[value="top"]')!
    act(() => { top.click() })
    expect(updateSettings).toHaveBeenLastCalledWith({ grid: 'top' })
    expect(container.querySelector('.phone-controls')?.className).toBe('phone-controls phone-controls--grid-top')
    // Wherever the client says it is: the computer may have changed it.
    remount({ snapshot: { settings: { ...DEFAULT_PHONE_SETTINGS, grid: 'top' } } })
    expect(container.querySelector('.phone-controls')?.className).toBe('phone-controls phone-controls--grid-top')
    act(() => { container.querySelector<HTMLInputElement>('.phone-settings input[value="bottom"]')!.click() })
    expect(updateSettings).toHaveBeenLastCalledWith({ grid: 'bottom' })
    expect(storage.size).toBe(0)
  })

  it("draws the flight's attitude indicator in the pitch/roll pad unless Settings asks for the plain one", async () => {
    const instrument = { draw: vi.fn(), destroy: vi.fn() }
    const renderer = { halfShare: .5, mount: vi.fn(() => instrument) }
    const loadAttitude = vi.fn(() => Promise.resolve(renderer))
    const attitude = { rollRad: .2, pitchRad: 0, headingRad: 0, northVelocityFps: 0, eastVelocityFps: 0, verticalSpeedFps: 0, aileron: 0, elevator: 0 }
    mount({ loadAttitude, attitude })
    await act(async () => { await Promise.resolve() })
    const pad = () => container.querySelector('.phone-stick:not(.phone-stick--rudder)')!
    expect(pad().classList).toContain('phone-stick--attitude')
    expect(renderer.mount).toHaveBeenCalledWith(pad().querySelector('.phone-stick__instrument'))

    const plain = container.querySelector<HTMLInputElement>('.phone-settings input[name="phone-attitude"][value="off"]')!
    act(() => { plain.click() })
    expect(updateSettings).toHaveBeenLastCalledWith({ attitude: false })
    expect(pad().classList).not.toContain('phone-stick--attitude')
    expect(pad().querySelector('.phone-stick__instrument')).toBeNull()
    expect(instrument.destroy).toHaveBeenCalledTimes(1)

    // Turned off from the start, the renderer is never even fetched.
    loadAttitude.mockClear()
    remount({ loadAttitude, attitude, snapshot: { settings: { ...DEFAULT_PHONE_SETTINGS, attitude: false } } })
    expect(loadAttitude).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('.phone-settings input[name="phone-attitude"][value="off"]')!.checked).toBe(true)
  })

  it("writes the flight's readings on the pad's corners instead of the grid's IAS and ALT", async () => {
    const renderer = { halfShare: .5, mount: vi.fn(() => ({ draw: vi.fn(), destroy: vi.fn() })) }
    const loadAttitude = vi.fn(() => Promise.resolve(renderer))
    const plain = { rollRad: 0, pitchRad: 0, headingRad: Math.PI / 2, northVelocityFps: 0, eastVelocityFps: 0, verticalSpeedFps: -8.5, aileron: 0, elevator: 0 }
    const attitude: PhoneAttitude = { ...plain, readings: { iasKt: 92, altitudeFt: 4250, aoaDeg: 4.5, tints: { ias: .4, vs: -.7 } } }
    // The pad draws on the next animation frame.
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const drawFrame = async () => {
      await act(async () => { await Promise.resolve() })
      act(() => { for (const frame of frames.splice(0)) frame(0) })
    }
    mount({ loadAttitude, attitude })
    await drawFrame()
    const corner = (reading: string) => container.querySelector<HTMLElement>(`.phone-stick__readings [data-reading="${reading}"]`)!
    const value = (reading: string) => corner(reading).querySelector('.flight-hud__value')!.textContent
    expect([value('ias'), value('hdg'), value('vs'), value('aoa'), value('alt')]).toEqual(['092', '090', '- 510', ' 4.5', '4250'])
    expect(corner('ias').style.getPropertyValue('--hud-tint')).toBe('0.40')
    expect(corner('aoa').dataset.tint).toBeUndefined()
    expect(corner('vs').dataset).toMatchObject({ vsDirection: 'down', vsInk: 'light' })
    expect([...grid().querySelectorAll('.flight-hud__label')].map(label => label.textContent)).toEqual(['HDG'])

    // A computer that sends no readings keeps them in the grid, and the corners say only what the attitude does.
    remount({ loadAttitude, attitude: plain })
    await drawFrame()
    expect([...grid().querySelectorAll('.flight-hud__label')].map(label => label.textContent)).toEqual(['IAS', 'ALT', 'HDG'])
    expect(['ias', 'aoa', 'alt'].map(reading => corner(reading).hidden)).toEqual([true, true, true])
    expect(value('hdg')).toBe('090')
  })

  it('switches automatic flaps from AUTO on the flaps lever, on a computer that has them', () => {
    mount({ status: { autoFlaps: false } })
    const auto = () => button('AUTO')!
    expect(auto().getAttribute('aria-pressed')).toBe('false')
    act(() => { auto().click() })
    expect(setAutoFlaps).toHaveBeenLastCalledWith(true)
    remount({ status: { autoFlaps: true } })
    expect(auto().classList).toContain('is-on')
    act(() => { auto().click() })
    expect(setAutoFlaps).toHaveBeenLastCalledWith(false)
    remount()
    expect(button('AUTO')).toBeUndefined()
  })

  it("switches each trim assist from the HUD's AUTO TRIM corner, on its own", () => {
    mount({ status: { autoTrim: { pitch: false, roll: false } } })
    const corner = (axis: 'pitch' | 'roll') => container.querySelector<HTMLButtonElement>(`.flight-hud__auto-trim--${axis}`)!
    const slider = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    expect(corner('roll').textContent).toBe('TRIMAUTO')
    expect(corner('pitch').textContent).toBe('AUTOTRIM')
    act(() => { corner('roll').click() })
    expect(setAutoTrim).toHaveBeenLastCalledWith('roll', true)
    // The computer says roll is on. Pitch stays as it was, and its own tap turns only it on.
    remount({ status: { autoTrim: { pitch: false, roll: true } } })
    expect(corner('roll').classList).toContain('is-on')
    expect(corner('roll').getAttribute('aria-pressed')).toBe('true')
    expect(corner('pitch').classList).not.toContain('is-on')
    // As on the HUD, an axis's trim is the assist's while it is on.
    expect(slider('Roll trim').disabled).toBe(true)
    expect(slider('Pitch trim').disabled).toBe(false)
    act(() => { corner('pitch').click() })
    expect(setAutoTrim).toHaveBeenLastCalledWith('pitch', true)
    remount({ status: { autoTrim: { pitch: true, roll: true } } })
    expect([corner('roll'), corner('pitch')].map(button => button.classList.contains('is-on'))).toEqual([true, true])
    act(() => { corner('roll').click() })
    expect(setAutoTrim).toHaveBeenLastCalledWith('roll', false)
    expect(setAutoTrim).toHaveBeenCalledTimes(3)

    // A computer without trim assists keeps the corner that centres trim.
    remount()
    act(() => { button('Center roll trim')!.click() })
    expect(updateControls).toHaveBeenLastCalledWith({ rollTrim: 0 })
    expect(slider('Roll trim').disabled).toBe(false)
  })

  it("draws the engine's spools beside the throttle lever", () => {
    mount({ engine: { phase: 'RUNNING', kind: 'turbine', n1: 41, n2: 78, maxN2: 104, state: 'running', start: 1 } })
    const gauge = (name: string) => container.querySelector<HTMLElement>(`.phone-throttle [data-gauge="${name}"]`)!
    expect(gauge('n1').style.getPropertyValue('--throttle-gauge')).toBe('0.41')
    expect(gauge('n2').style.getPropertyValue('--throttle-gauge')).toBe('0.75')
    remount({ engine: { phase: 'RUNNING', kind: 'piston', rpm: 1350, maxRpm: 2700, state: 'running', start: 1 } })
    expect(gauge('rpm').style.getPropertyValue('--throttle-gauge')).toBe('0.5')
    expect(container.querySelector('.phone-throttle [data-gauge="n1"]')).toBeNull()
  })

  it('draws the yaw slider where the rudder is, and returns it to centre on release', () => {
    // The regression this component exists for: the value comes from the
    // client's control state, so the thumb is wherever the aircraft's rudder is.
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: -.42 } } })
    expect(yawTrack().value).toBe('-0.42')
    expect(text('.phone-yaw output')).toBe('-42%')
    pointer(yawSurface(), 'pointerdown', { clientX: yawAt(-.42) })
    pointer(yawSurface(), 'pointerup')
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })
  })

  it('takes the yaw to the finger, wherever on the track it lands, and follows it', () => {
    mount()
    pointer(yawSurface(), 'pointerdown', { clientX: yawAt(.5) })
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: .5 })
    pointer(yawSurface(), 'pointermove', { clientX: yawAt(-.25) })
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: -.25 })
    pointer(yawSurface(), 'pointerup')
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })
  })

  it('moves the yaw only from its handle when Settings says to grab it, and remembers that', () => {
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: .5 } } })
    act(() => { container.querySelector<HTMLInputElement>('.phone-settings input[name="phone-sliders"][value="grab"]')!.click() })
    expect(updateSettings).toHaveBeenLastCalledWith({ sliders: 'grab' })
    updateControls.mockClear()
    // Off the handle, a press neither moves it nor takes it: no release follows.
    pointer(yawSurface(), 'pointerdown', { clientX: yawAt(-.5) })
    pointer(yawSurface(), 'pointerup')
    expect(updateControls).not.toHaveBeenCalled()
    // On it, the handle goes as far as the finger does, from where it was.
    pointer(yawSurface(), 'pointerdown', { clientX: yawAt(.5) + 4 })
    pointer(yawSurface(), 'pointermove', { clientX: yawAt(.5) + 4 + 19 })
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: .7 })
    pointer(yawSurface(), 'pointerup')
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })

    remount({ snapshot: { settings: { ...DEFAULT_PHONE_SETTINGS, sliders: 'grab' } } })
    expect(container.querySelector<HTMLInputElement>('.phone-settings input[name="phone-sliders"][value="grab"]')!.checked).toBe(true)
  })

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('centres yaw when the finger that took it sends %s, wherever it lifts', type => {
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: .6 } } })
    pointer(yawSurface(), 'pointerdown', { pointerId: 7, clientX: yawAt(.6) })
    // Held by the box round the range, so the browser cannot take the finger away mid-drag.
    expect(yawSurface().setPointerCapture).toHaveBeenCalledWith(7)
    pointer(yawSurface(), type, { pointerId: 8 })
    expect(updateControls).not.toHaveBeenCalled()
    pointer(yawSurface(), type, { pointerId: 7 })
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })
    const sent = updateControls.mock.calls.length
    pointer(yawSurface(), type, { pointerId: 7 })
    expect(updateControls.mock.calls).toHaveLength(sent)
  })

  it.each(['pointerup', 'pointercancel'])('keeps yaw in hold mode when its finger sends %s', type => {
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: .6 }, settings: { ...DEFAULT_PHONE_SETTINGS, yawRelease: 'hold' } } })
    pointer(yawSurface(), 'pointerdown', { pointerId: 7, clientX: yawAt(.6) })
    pointer(yawSurface(), type, { pointerId: 7 })
    expect(updateControls).not.toHaveBeenCalled()
    expect(yawTrack().value).toBe('0.6')
  })

  it('centres once when the finger lifts and capture is then lost', () => {
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: .6 } } })
    pointer(yawSurface(), 'pointerdown', { pointerId: 7, clientX: yawAt(.6) })
    pointer(yawSurface(), 'pointerup', { pointerId: 7 })
    pointer(yawSurface(), 'lostpointercapture', { pointerId: 7 })
    expect(updateControls.mock.calls).toEqual([[{ rudder: 0 }]])
  })

  it('animates an outside yaw release and lets a new press interrupt that return', () => {
    vi.useFakeTimers()
    try {
      mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: 1 }, settings: { ...DEFAULT_PHONE_SETTINGS, yawReturnMs: 500 } } })
      pointer(yawSurface(), 'pointerdown', { pointerId: 7, clientX: yawAt(1) })
      pointer(yawSurface(), 'pointerup', { pointerId: 7 })
      act(() => { vi.advanceTimersByTime(250) })
      expect(yawReturn()).toBeGreaterThan(.3)
      expect(yawReturn()).toBeLessThan(.7)
      // On the handle where the screen still draws it, so the press itself moves nothing.
      pointer(yawSurface(), 'pointerdown', { pointerId: 8, clientX: yawAt(1) })
      const sent = updateControls.mock.calls.length
      act(() => { vi.advanceTimersByTime(300) })
      expect(updateControls.mock.calls).toHaveLength(sent)
      pointer(yawSurface(), 'pointerup', { pointerId: 7 })
      act(() => { vi.advanceTimersByTime(100) })
      expect(updateControls.mock.calls).toHaveLength(sent)
      pointer(yawSurface(), 'pointerup', { pointerId: 8 })
      act(() => { vi.advanceTimersByTime(550) })
      expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })
    } finally { vi.useRealTimers() }
  })

  it('keeps the yaw where the finger left it when Settings says so, and remembers that', () => {
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: .5 } } })
    act(() => { container.querySelector<HTMLInputElement>('.phone-settings input[value="hold"]')!.click() })
    expect(updateSettings).toHaveBeenLastCalledWith({ yawRelease: 'hold', yawReturnMs: 0 })
    // No return time to set: there is no return.
    expect(container.querySelector('.phone-settings__slider')).toBeNull()
    updateControls.mockClear()
    pointer(yawSurface(), 'pointerdown', { clientX: yawAt(.5) })
    pointer(yawSurface(), 'pointerup')
    pointer(yawSurface(), 'pointercancel')
    // React's onBlur is focusout; a bubbling `blur` would reach the window
    // listeners the stick and brake centre themselves from instead.
    act(() => { yawTrack().dispatchEvent(new Event('focusout', { bubbles: true })) })
    expect(updateControls).not.toHaveBeenCalled()
    expect(yawTrack().getAttribute('aria-label')).toBe('Yaw rudder. Holds where you leave it.')

    // The client's choice is the screen's, and centring again returns the parked rudder.
    remount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: .5 }, settings: { ...DEFAULT_PHONE_SETTINGS, yawRelease: 'hold' } } })
    expect(container.querySelector<HTMLInputElement>('.phone-settings input[value="hold"]')!.checked).toBe(true)
    act(() => { container.querySelector<HTMLInputElement>('.phone-settings input[value="center"]')!.click() })
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })
    expect(updateSettings).toHaveBeenLastCalledWith({ yawRelease: 'center', yawReturnMs: 0 })
  })

  it('sweeps the yaw home over the return time Settings sets', () => {
    vi.useFakeTimers()
    mount({ snapshot: { controls: { ...NEUTRAL_CONTROLS, rudder: 1 } } })
    const time = container.querySelector<HTMLInputElement>('.phone-settings__slider input')!
    expect(text('.phone-settings__slider output')).toBe('Instant')
    drag(time, '500')
    expect(text('.phone-settings__slider output')).toBe('0.50s')
    expect(updateSettings).toHaveBeenLastCalledWith({ yawRelease: 'center', yawReturnMs: 500 })

    updateControls.mockClear()
    pointer(yawSurface(), 'pointerdown', { clientX: yawAt(1) })
    pointer(yawSurface(), 'pointerup')
    // Each step of the sweep is an ordinary rudder update, so the aircraft
    // yaws its way back rather than snapping.
    act(() => { vi.advanceTimersByTime(250) })
    expect(yawReturn()).toBeGreaterThan(.3)
    expect(yawReturn()).toBeLessThan(.7)
    act(() => { vi.advanceTimersByTime(300) })
    expect(updateControls).toHaveBeenLastCalledWith({ rudder: 0 })
    // It ends: no frame goes on writing zeroes.
    const finished = updateControls.mock.calls.length
    act(() => { vi.advanceTimersByTime(300) })
    expect(updateControls.mock.calls.length).toBe(finished)
    vi.useRealTimers()
  })

  it('sends a camera swipe with the desktop drag signs', () => {
    mount()
    const pad = container.querySelector('.phone-camera')!
    const touch = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { pointerId: 1, clientX: x, clientY: y, button: 0 })
      act(() => { pad.dispatchEvent(event) })
    }
    touch('pointerdown', 100, 100)
    expect(setCameraFingers.mock.calls.map(([count]) => count)).toEqual([1])
    // Down and to the right, the way dragging the desktop canvas goes.
    touch('pointermove', 140, 120)
    const [{ yaw, pitch }] = nudgeCamera.mock.calls.at(-1)!
    expect(yaw).toBeGreaterThan(0)
    expect(pitch).toBeGreaterThan(0)
    // The computer glides the swipe on from the lift.
    touch('pointerup', 140, 120)
    expect(setCameraFingers.mock.calls.map(([count]) => count)).toEqual([1, 0])
  })

  it('turns the view with two fingers unless Settings says they only zoom, and remembers that', () => {
    const twoFingersMove = () => {
      const pad = container.querySelector('.phone-camera')!
      const touch = (type: string, pointerId: number, x: number, y: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.assign(event, { pointerId, clientX: x, clientY: y, button: 0 })
        act(() => { pad.dispatchEvent(event) })
      }
      nudgeCamera.mockClear()
      touch('pointerdown', 1, 100, 100)
      touch('pointerdown', 2, 200, 100)
      touch('pointermove', 1, 140, 100)
      touch('pointermove', 2, 240, 100)
      touch('pointerup', 1, 140, 100)
      touch('pointerup', 2, 240, 100)
      return nudgeCamera.mock.calls.reduce((total, [move]) => total + move.yaw, 0)
    }
    mount()
    expect(twoFingersMove()).toBeGreaterThan(0)
    act(() => { container.querySelector<HTMLInputElement>('.phone-settings input[name="phone-two-fingers"][value="zoom"]')!.click() })
    expect(updateSettings).toHaveBeenLastCalledWith({ twoFingers: 'zoom' })

    remount({ snapshot: { settings: { ...DEFAULT_PHONE_SETTINGS, twoFingers: 'zoom' } } })
    expect(container.querySelector<HTMLInputElement>('.phone-settings input[name="phone-two-fingers"][value="zoom"]')!.checked).toBe(true)
    expect(twoFingersMove()).toBe(0)
  })
})
