import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPhoneControlSession } from '../src/createPhoneControlSession'
import { DEFAULT_PHONE_CAMERA_TUNING } from '../src/phoneCameraTuning'
import { DEFAULT_PHONE_CONTROLLER_SETTINGS } from '../src/phoneControllerSettings'
import { DEFAULT_CONTROL_SHARING, type ControlSharing } from '../src/controlSharing'
import { parsePairingUrl } from '../src/pairing'
import { PROTOCOL_MISMATCH_MESSAGE, type AircraftStatus, type ControlSurfaceState, type PhoneControllerSettings, type RemoteMessage } from '../src/protocol'
import type { createPeerEndpoint, SessionTransport } from '../src/peerTransport'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class Transport implements SessionTransport {
  id = crypto.randomUUID()
  ready = Promise.resolve()
  nativeOpen = false
  nativeStreamId: number | null = null
  nativeBufferedAmount = 0
  nativeReady = deferred<number>()
  reliable: RemoteMessage[] = []
  native: RemoteMessage[] = []
  reliableListeners = new Set<(value: unknown) => void>()
  nativeListeners = new Set<(value: unknown) => void>()
  closeListeners = new Set<(reason: string) => void>()
  closed = false
  onReliable(handler: (value: unknown) => void) { this.reliableListeners.add(handler); return () => { this.reliableListeners.delete(handler) } }
  onNative(handler: (value: unknown) => void) { this.nativeListeners.add(handler); return () => { this.nativeListeners.delete(handler) } }
  onClose(handler: (reason: string) => void) { this.closeListeners.add(handler); return () => { this.closeListeners.delete(handler) } }
  sendReliable = vi.fn((value: unknown) => { this.reliable.push(value as RemoteMessage); return !this.closed })
  sendNative = vi.fn((value: unknown) => { this.native.push(value as RemoteMessage); return !this.closed })
  openNative = vi.fn((id = 1) => { this.nativeStreamId = id; return this.nativeReady.promise })
  diagnostics = async () => ({ path: 'direct' as const, iceRttMs: 5, ordered: false, maxRetransmits: 0, bufferedAmount: 0 })
  close = vi.fn(() => {
    if (this.closed) return
    this.closed = true
    this.nativeOpen = false
    for (const handler of this.closeListeners) handler('closed')
  })
  receive(message: unknown) { for (const handler of this.reliableListeners) handler(message) }
  receiveNative(message: unknown) { for (const handler of this.nativeListeners) handler(message) }
  openedNative() { this.nativeOpen = true; this.nativeReady.resolve(this.nativeStreamId!) }
  last<T extends RemoteMessage['type']>(type: T): Extract<RemoteMessage, { type: T }> {
    const messages = [...this.reliable, ...this.native]
    const result = messages.findLast(value => value.type === type)
    if (!result) throw new Error(`No ${type} message`)
    return result as Extract<RemoteMessage, { type: T }>
  }
}

class SlowReliableTransport extends Transport {
  readonly reliableReady = deferred<void>()
  override ready = this.reliableReady.promise
  openReliable() { this.reliableReady.resolve() }
}

const allSessions: ReturnType<typeof createPhoneControlSession>[] = []
function setup(extra: Partial<Parameters<typeof createPhoneControlSession>[0]> = {}) {
  let time = 0
  let localActive = false
  let pageVisible = true
  let sharing: ControlSharing = { ...DEFAULT_CONTROL_SHARING }
  const state: AircraftStatus = {
    owner: 'local', paused: false, viewMode: 'third', airspeedKts: 100, altitudeFt: 4000, headingDeg: 90,
    controls: { elevator: 0, aileron: 0, rudder: 0, throttle: .67, pitchTrim: -.12, rollTrim: .08, flaps: 1 / 3, brake: 0 },
  }
  type EndpointOptions = Parameters<typeof createPeerEndpoint>[0]
  const endpoints: { callbacks: NonNullable<EndpointOptions>; destroy: ReturnType<typeof vi.fn> }[] = []
  const createEndpoint: typeof createPeerEndpoint = (callbacks = {}) => {
    const endpoint = { callbacks, ready: Promise.resolve(`desktop-${endpoints.length}`), connect: () => new Transport(), destroy: vi.fn() }
    endpoints.push(endpoint)
    return endpoint
  }
  const ownership = vi.fn((owner: 'local' | 'phone', controls: ControlSurfaceState) => { state.owner = owner; state.controls = { ...controls } })
  const pause = vi.fn((paused: boolean) => { state.paused = paused })
  const view = vi.fn((mode: 'first' | 'third') => { state.viewMode = mode })
  const session = createPhoneControlSession({
    getStatus: () => ({ ...state, controls: { ...state.controls } }), hasActiveLocalInput: () => localActive,
    isPageVisible: () => pageVisible, getSharing: () => sharing,
    onOwnershipChange: ownership, setPaused: pause, setViewMode: view, createEndpoint, now: () => time, ...extra,
  })
  allSessions.push(session)
  // Time passing for a computer that keeps up: its heartbeats wake it on time.
  // `jump` is the other kind, this computer stalled, which nothing sees until after.
  const advance = async (ms: number) => {
    for (let left = ms; left > 0; left -= 25) {
      const step = Math.min(25, left)
      time += step
      await vi.advanceTimersByTimeAsync(step)
    }
  }
  const pair = async () => {
    await session.startPairing()
    const invitation = parsePairingUrl(session.getSnapshot().invitationUrl!)!
    const transport = new Transport()
    endpoints.at(-1)!.callbacks.onConnection!(transport)
    transport.receive({ v: 1, type: 'hello', secret: invitation.secret })
    transport.openedNative()
    await Promise.resolve()
    const welcome = transport.last('welcome')
    transport.receive({ v: 1, type: 'ready', session: welcome.session, epoch: welcome.epoch })
    await advance(50)
    return transport
  }
  const requestControl = (transport: Transport, id = 1) => {
    const heartbeat = transport.last('heartbeat')
    transport.receive({ v: 1, type: 'action', session: heartbeat.session, epoch: heartbeat.epoch, lease: heartbeat.lease, id, action: 'requestControl' })
    return transport.last('handoff')
  }
  const grant = (transport: Transport, id = 1) => {
    const handoff = requestControl(transport, id)
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: id })
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: handoff.controls })
    return handoff
  }
  return { session, state, endpoints, ownership, pause, view, advance, pair, requestControl, grant,
    setVisible(value: boolean) { pageVisible = value },
    setSharing(patch: Partial<ControlSharing>) { sharing = { ...sharing, ...patch } },
    setLocalActive(value: boolean) { localActive = value }, jump(ms: number) { time += ms } }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { for (const session of allSessions.splice(0)) session.destroy(); vi.useRealTimers() })

describe('desktop phone control session', () => {
  it('draws the phone camera through the A/B settings, read live', async () => {
    const tuning = { ...DEFAULT_PHONE_CAMERA_TUNING, send: 'timer' as const, source: 'delta' as const, present: 'arrival' as const }
    const h = setup({ getCameraTuning: () => tuning })
    const transport = await h.pair()
    const handoff = h.grant(transport)
    const frame = (seq: number, delta: number, total: number) => ({
      v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq, lease: handoff.lease, controls: handoff.controls,
      camera: { yaw: delta, pitch: 0 }, aim: { yaw: total, pitch: 0, zoom: 0, t: seq * 16 },
    })
    // Frame 2 is lost. Read as deltas, its movement is gone.
    transport.receiveNative(frame(1, .01, .01))
    transport.receiveNative(frame(3, .01, .03))
    expect(h.session.takeCameraAim()!.yaw).toBeCloseTo(.02)
    // Read as running totals, a later frame carries it.
    tuning.source = 'total'
    transport.receiveNative(frame(4, .01, .04))
    transport.receiveNative(frame(6, .01, .06))
    expect(h.session.takeCameraAim()!.yaw).toBeCloseTo(.03)
    // The phone is told how to send on every heartbeat; absent means the original.
    await h.advance(50)
    expect('controlSend' in transport.last('heartbeat')).toBe(false)
    tuning.send = 'batch'
    await h.advance(50)
    expect(transport.last('heartbeat')).toMatchObject({ controlSend: 'batch' })
  })

  it("keeps the phone's own settings here, answers each change, and tells only a phone that sent its own", async () => {
    let held: PhoneControllerSettings = { ...DEFAULT_PHONE_CONTROLLER_SETTINGS, yawReturnMs: 300 }
    const set = vi.fn((settings: PhoneControllerSettings) => { held = { ...settings } })
    const h = setup({ phoneSettings: { get: () => ({ ...held }), set } })
    const transport = await h.pair()
    const sent = () => transport.reliable.filter(message => message.type === 'settings')
    const welcome = transport.last('welcome')
    const from = (settings: PhoneControllerSettings, rev: number, extra: object = {}, epoch = welcome.epoch) =>
      transport.receive({ v: 1, type: 'settings', session: welcome.session, epoch, settings, rev, ...extra })
    // A phone that predates this, or has not spoken yet, is never sent them.
    h.session.syncPhoneSettings()
    expect(sent()).toEqual([])

    // Its first: kept only where this computer still has the default.
    from({ grid: 'top', yawRelease: 'hold', yawReturnMs: 500, haptics: false }, 1, { initial: true })
    // It sends no camera pad setting, as a phone that predates it would, so the default stands in for it.
    const merged = { grid: 'top', yawRelease: 'hold', yawReturnMs: 300, haptics: false, twoFingers: 'both' }
    expect(set).toHaveBeenLastCalledWith(merged)
    expect(transport.last('settings')).toMatchObject({ settings: merged, rev: 1 })

    // A change on the phone is taken whole, and answered with its own count,
    // whatever epoch the phone had heard of: control changing hands does not lose it.
    h.grant(transport)
    from({ ...merged, grid: 'bottom' }, 2)
    expect(held.grid).toBe('bottom')
    expect(transport.last('settings')).toMatchObject({ settings: { grid: 'bottom' }, rev: 2 })
    // An older or repeated one is not.
    from({ ...merged, grid: 'top' }, 2)
    from({ ...merged, grid: 'top' }, 1)
    expect(held.grid).toBe('bottom')
    expect(set).toHaveBeenCalledTimes(2)

    // A change here reaches the phone once, still answering the phone's latest.
    held = { ...held, haptics: true }
    const before = sent().length
    h.session.syncPhoneSettings()
    h.session.syncPhoneSettings()
    expect(sent().length).toBe(before + 1)
    expect(transport.last('settings')).toMatchObject({ settings: { haptics: true }, rev: 2 })
  })

  it("leaves a phone with its own settings when this computer keeps none", async () => {
    const h = setup()
    const transport = await h.pair()
    const welcome = transport.last('welcome')
    transport.receive({ v: 1, type: 'settings', session: welcome.session, epoch: welcome.epoch, settings: DEFAULT_PHONE_CONTROLLER_SETTINGS, rev: 1, initial: true })
    h.session.syncPhoneSettings()
    expect(transport.reliable.some(message => message.type === 'settings')).toBe(false)
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('reads the fingers on the phone camera pad, and only while the phone flies', async () => {
    const frames = vi.fn()
    const h = setup({ getCameraTuning: () => ({ ...DEFAULT_PHONE_CAMERA_TUNING, present: 'arrival' }), onCameraAim: frames })
    const transport = await h.pair()
    expect(h.session.cameraFingers()).toBeNull()
    const handoff = h.grant(transport)
    const frame = (seq: number, yaw: number, down?: number) => ({
      v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq, lease: handoff.lease, controls: handoff.controls,
      aim: { yaw, pitch: 0, zoom: 0, t: seq * 16, ...(down === undefined ? {} : { down }) },
    })
    // A phone that predates the count says nothing.
    transport.receiveNative(frame(1, 0))
    h.session.takeCameraAim()
    expect(h.session.cameraFingers()).toBeNull()
    // A finger landing asks for a frame even before it moves, so a paused view stops its glide.
    frames.mockClear()
    transport.receiveNative(frame(2, 0, 1))
    expect(frames).toHaveBeenCalledTimes(1)
    expect(h.session.hasPendingCameraAim()).toBe(true)
    h.session.takeCameraAim()
    expect(h.session.cameraFingers()).toBe(1)
    expect(h.session.hasPendingCameraAim()).toBe(false)
    transport.receiveNative(frame(3, .02, 0))
    expect(h.session.takeCameraAim()!.yaw).toBeCloseTo(.02)
    expect(h.session.cameraFingers()).toBe(0)
    transport.receiveNative(frame(4, .02, 1))
    h.session.reset()
    expect(h.session.cameraFingers()).toBeNull()
  })

  it('reports what became of every control frame to an opt-in trace, and only then asks the phone for timings', async () => {
    const plain = setup()
    const plainTransport = await plain.pair()
    expect('trace' in plainTransport.last('heartbeat')).toBe(false)

    const controlFrame = vi.fn()
    // Drawn on arrival, so what a frame carried is drawn whole at once.
    const h = setup({ trace: { controlFrame }, getCameraTuning: () => ({ ...DEFAULT_PHONE_CAMERA_TUNING, present: 'arrival' }) })
    const transport = await h.pair()
    expect(transport.last('heartbeat')).toMatchObject({ trace: 1 })
    const handoff = h.grant(transport)
    expect(controlFrame).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 0 }), 'accepted', expect.any(Number))
    const frame = (seq: number, lease = handoff.lease) => ({
      v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq, lease, controls: handoff.controls,
      camera: { yaw: .01, pitch: 0 },
    })
    transport.receiveNative(frame(2))
    transport.receiveNative(frame(1))
    expect(controlFrame).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 1 }), 'out-of-order', expect.any(Number))
    // A late frame on the unordered channel loses its camera movement with it.
    expect(h.session.takeCameraAim()!.yaw).toBeCloseTo(.01)
    await h.advance(300)
    transport.receiveNative(frame(3))
    expect(controlFrame).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 3 }), 'stale-lease', expect.any(Number))
  })

  it('pairs without changing flight and requires both native readiness confirmations', async () => {
    const h = setup()
    await h.session.startPairing()
    expect(h.session.getSnapshot().phase).toBe('invitation')
    const secret = parsePairingUrl(h.session.getSnapshot().invitationUrl!)!.secret
    const transport = new Transport()
    h.endpoints[0].callbacks.onConnection!(transport)
    transport.receive({ v: 1, type: 'hello', secret })
    expect(h.session.getSnapshot().phase).toBe('authenticating')
    expect(h.session.getSnapshot().invitationUrl).toBeNull()
    const welcome = transport.last('welcome')
    transport.receive({ v: 1, type: 'ready', session: welcome.session, epoch: welcome.epoch })
    expect(h.session.getSnapshot().phase).toBe('authenticating')
    transport.openedNative()
    await Promise.resolve()
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'paired', owner: 'local' })
    expect(h.ownership).not.toHaveBeenCalled()
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('claims exactly one phone synchronously and rejects stale endpoint callbacks', async () => {
    const h = setup()
    await h.session.startPairing()
    const oldCallbacks = h.endpoints[0].callbacks
    const secret = parsePairingUrl(h.session.getSnapshot().invitationUrl!)!.secret
    const winner = new Transport()
    const loser = new Transport()
    oldCallbacks.onConnection!(winner)
    oldCallbacks.onConnection!(loser)
    winner.receive({ v: 1, type: 'hello', secret })
    loser.receive({ v: 1, type: 'hello', secret })
    expect(winner.openNative).toHaveBeenCalledOnce()
    expect(loser.closed).toBe(true)
    expect(loser.openNative).not.toHaveBeenCalled()
    await h.session.startPairing()
    const stale = new Transport()
    oldCallbacks.onConnection!(stale)
    oldCallbacks.onSignalingState!(false)
    expect(stale.closed).toBe(true)
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'invitation', signalingAvailable: true })
  })

  it('bounds pending unauthenticated connections and the hello deadline', async () => {
    const h = setup()
    await h.session.startPairing()
    const pending = Array.from({ length: 5 }, () => new Transport())
    for (const transport of pending) h.endpoints[0].callbacks.onConnection!(transport)
    expect(pending[4].closed).toBe(true)
    expect(pending[0].closed).toBe(false)
    await h.advance(5000)
    expect(pending.every(transport => transport.closed)).toBe(true)
    expect(h.session.getSnapshot().phase).toBe('invitation')
  })

  it('starts the unauthenticated hello deadline only after PeerJS opens the reliable channel', async () => {
    const h = setup()
    await h.session.startPairing()
    const transport = new SlowReliableTransport()
    h.endpoints[0].callbacks.onConnection!(transport)
    await h.advance(5_100)
    expect(transport.closed).toBe(false)
    transport.openReliable()
    await Promise.resolve()
    await h.advance(4_999)
    expect(transport.closed).toBe(false)
    await h.advance(1)
    expect(transport.closed).toBe(true)
    expect(h.session.getSnapshot().phase).toBe('invitation')
  })

  it('expires invitations and ignores callbacks from the expired generation', async () => {
    const h = setup()
    await h.session.startPairing()
    const callbacks = h.endpoints[0].callbacks
    await h.advance(120_000)
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'expired', invitationUrl: null, expiresAt: null })
    callbacks.onSignalingState!(false)
    const incoming = new Transport()
    callbacks.onConnection!(incoming)
    expect(incoming.closed).toBe(true)
    expect(h.session.getSnapshot().signalingAvailable).toBe(true)
    expect(h.endpoints[0].destroy).toHaveBeenCalledOnce()
  })

  it('bounds native ready exchange even when the native channel opened but phone never confirms', async () => {
    const h = setup()
    await h.session.startPairing()
    const secret = parsePairingUrl(h.session.getSnapshot().invitationUrl!)!.secret
    const transport = new Transport()
    h.endpoints[0].callbacks.onConnection!(transport)
    transport.receive({ v: 1, type: 'hello', secret })
    transport.openedNative()
    await Promise.resolve()
    await h.advance(15_000)
    expect(h.session.getSnapshot().phase).toBe('error')
    expect(transport.closed).toBe(true)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it.each([{ v: 1, type: 'hello', secret: 'x'.repeat(43) }, { type: 'unknown' }])('rejects invalid authentication without modifying local flight', async (message) => {
    const h = setup()
    await h.session.startPairing()
    const transport = new Transport()
    h.endpoints[0].callbacks.onConnection!(transport)
    transport.receive(message)
    expect(transport.closed).toBe(true)
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'invitation', owner: 'local' })
    expect(h.ownership).not.toHaveBeenCalled()
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('requires a centered fresh snapshot and handoff acknowledgement, preserving persistent controls and pause', async () => {
    const h = setup()
    h.state.paused = true
    const transport = await h.pair()
    const baseline = { ...h.state.controls }
    const handoff = h.requestControl(transport)
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: { ...baseline, throttle: 0 } })
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: handoff.requestId })
    expect(h.session.getSnapshot().owner).toBe('local')
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 1, lease: handoff.lease, controls: baseline })
    expect(h.session.getSnapshot().owner).toBe('phone')
    expect(h.ownership).toHaveBeenCalledWith('phone', baseline, true)
    expect(h.state.paused).toBe(true)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it.each(['pause', 'timeout'] as const)('cancels handoff on %s changes before ownership', async (change) => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.requestControl(transport)
    if (change === 'pause') h.state.paused = true
    await h.advance(change === 'timeout' ? 2000 : 50)
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: handoff.requestId })
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: handoff.controls })
    expect(h.session.getSnapshot().owner).toBe('local')
    expect(h.ownership).not.toHaveBeenCalled()
    expect(transport.last('ack').ok).toBe(false)
  })

  it.each(['throttle', 'pitchTrim', 'rollTrim', 'flaps'] as const)('preserves handoff through passive %s changes when local input is unchanged', async key => {
    const h = setup({ getLocalInputRevision: () => 0 })
    const transport = await h.pair()
    const handoff = h.requestControl(transport)
    h.state.controls[key] = .2
    await h.advance(50)
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: handoff.requestId })
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: handoff.controls })
    expect(h.session.getSnapshot().owner).toBe('phone')
    expect(transport.last('granted')).toMatchObject({ epoch: handoff.epoch, requestId: handoff.requestId })
    expect(h.ownership).toHaveBeenCalledWith('phone', handoff.controls, true)
  })

  it('keeps the phone handoff live when local controls move or advance their revision', async () => {
    let revision = 0
    const h = setup({ getLocalInputRevision: () => revision })
    const transport = await h.pair()
    const handoff = h.requestControl(transport)
    revision++
    h.setLocalActive(true)
    h.state.controls.aileron = .7
    h.state.controls.throttle = .2
    h.session.noteLocalInput()
    await h.advance(50)
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: handoff.requestId })
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: handoff.controls })
    expect(h.session.getSnapshot().owner).toBe('phone')
    expect(h.ownership).toHaveBeenCalledWith('phone', handoff.controls, true)
  })

  it('rejects reordered, duplicate, malformed and old-epoch controls before replacing the mailbox', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    const frame = { v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 2, lease: handoff.lease, controls: { ...handoff.controls, elevator: .8 } }
    transport.receiveNative(frame)
    for (const bad of [
      { ...frame, seq: 1, controls: { ...frame.controls, elevator: -.8 } },
      { ...frame, controls: { ...frame.controls, elevator: -.8 } },
      { ...frame, seq: 3, epoch: handoff.epoch - 1, controls: { ...frame.controls, elevator: -.8 } },
      { ...frame, seq: 3, controls: { ...frame.controls, elevator: 2 } },
      { ...frame, seq: 3, lease: 999999, controls: { ...frame.controls, elevator: -.8 } },
    ]) transport.receiveNative(bad)
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ elevator: .8 })
    h.session.reset()
    transport.receiveNative({ ...frame, seq: 100 })
    expect(h.session.getSnapshot().owner).toBe('local')
    expect(h.state.controls).toMatchObject({ elevator: 0, throttle: .67, pitchTrim: -.12, flaps: 1 / 3 })
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('cancels a pending handoff on phone release without pausing local flight', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.requestControl(transport)
    transport.receive({ v: 1, type: 'action', session: handoff.session, epoch: handoff.epoch, lease: handoff.lease, id: 2, action: 'releaseControl' })
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: handoff.requestId })
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: handoff.controls })
    expect(h.session.getSnapshot().owner).toBe('local')
    expect(h.ownership).not.toHaveBeenCalled()
    expect(h.pause).not.toHaveBeenCalled()
    expect(transport.last('ack')).toMatchObject({ id: 2, ok: true })
  })

  it('bounds accepted control traffic at 120 frames per rolling second', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    for (let seq = 1; seq < 121; seq++) {
      transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq, lease: handoff.lease, controls: { ...handoff.controls, elevator: seq / 200 } })
    }
    // The centered handoff snapshot is the first of the 120 allowed frames.
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ elevator: 119 / 200 })
  })

  it('detects continuously delayed input using the echoed host lease, independently of receive time', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    const frame = (seq: number, elevator: number) => transport.receiveNative({ v: 1, type: 'controls',
      session: handoff.session, epoch: handoff.epoch, seq, lease: handoff.lease, controls: { ...handoff.controls, elevator } })
    for (let seq = 1; seq <= 3; seq++) { await h.advance(50); frame(seq, .2) }
    await h.advance(150)
    // Frames still arrive, but on a lease older than the stale limit: delayed
    // traffic, never applied. The last fresh command is held instead.
    for (let seq = 4; seq <= 40; seq++) { await h.advance(50); frame(seq, .9) }
    expect(h.session.getSnapshot().owner).toBe('phone')
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ elevator: .2 })
    // Past the hold, control comes back here, without a pause.
    for (let seq = 41; seq <= 105; seq++) { await h.advance(50); frame(seq, .9) }
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'paired', owner: 'local' })
    expect(h.pause).not.toHaveBeenCalled()
    frame(110, .9)
    expect(h.session.getSnapshot().owner).toBe('local')
  })

  it('rejects a hidden desktop handoff and checks visibility before physics even before the visibility event', async () => {
    const h = setup()
    const transport = await h.pair()
    h.setVisible(false)
    const heartbeat = transport.last('heartbeat')
    transport.receive({ v: 1, type: 'action', session: heartbeat.session, epoch: heartbeat.epoch, lease: heartbeat.lease, id: 1, action: 'requestControl' })
    expect(transport.last('ack').ok).toBe(false)
    expect(h.session.getSnapshot().owner).toBe('local')
    h.setVisible(true)
    h.grant(transport, 2)
    h.setVisible(false)
    expect(h.session.beforeStep(h.state.controls)).toBe(false)
    expect(h.pause).toHaveBeenCalledWith(true)
    expect(h.session.getSnapshot().owner).toBe('phone')
  })

  it('never takes a stall of this computer for silence from the phone', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    // A shader compiling as the engine lights: five seconds in which nothing
    // here runs, so nothing from the phone can arrive and no lease can leave.
    h.jump(5000)
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ aileron: 0 })
    // What the phone sent meanwhile waited behind the stall, on the lease it had.
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 1,
      lease: handoff.lease, controls: { ...handoff.controls, aileron: .5 }, starter: 1 })
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ aileron: .5 })
    expect(h.session.isStarterHeld()).toBe(true)
    h.jump(5000)
    await h.advance(100)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', message: 'Phone priority · Both devices connected' })
    expect(h.session.isStarterHeld()).toBe(true)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('holds the phone\'s last command, starter and all, through a silence shorter than the hold', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    const send = (seq: number, aileron: number) => {
      const { lease } = transport.last('heartbeat')
      transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq, lease,
        controls: { ...handoff.controls, aileron }, starter: 1 })
    }
    await h.advance(50)
    send(1, .3)
    // Nothing for a second and a half: the pilot still holds the starter and the stick.
    await h.advance(1500)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', message: 'Phone priority · Both devices connected · Phone signal lost · Holding its last command' })
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ aileron: .3 })
    expect(h.session.isStarterHeld()).toBe(true)
    // Heard again: it flies on in the same epoch, with no handoff and no pause.
    send(2, .1)
    await h.advance(50)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', message: 'Phone priority · Both devices connected' })
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ aileron: .1 })
    expect(h.session.log.entries().at(-1)).toMatchObject({ code: 'phone-silent', detail: expect.stringContaining('its last command held') })
    expect(h.ownership).toHaveBeenCalledTimes(1)
    expect(h.pause).not.toHaveBeenCalled()
    // Imported hold settings cannot shorten the fixed five-second loss window.
    h.setSharing({ holdMs: 0 })
    await h.advance(4950)
    expect(h.session.getSnapshot().owner).toBe('phone')
    expect(h.session.isStarterHeld()).toBe(true)
    await h.advance(100)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'local', message: 'Phone signal lost · Desktop controls · Back to the phone when it is heard' })
    expect(h.ownership).toHaveBeenLastCalledWith('local', expect.objectContaining({ aileron: 0, throttle: handoff.controls.throttle }), true)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('applies reliable actions once and rejects a delayed resume without fresh controls', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    const action = { v: 1, type: 'action', session: handoff.session, epoch: handoff.epoch, lease: handoff.lease, id: 2, action: 'setPaused', value: true }
    transport.receive(action)
    transport.receive(action)
    expect(h.pause).toHaveBeenCalledTimes(1)
    expect(transport.reliable.filter(message => message.type === 'ack' && message.id === 2)).toHaveLength(2)
    await h.advance(300)
    transport.receive({ ...action, id: 3, value: false })
    expect(h.state.paused).toBe(true)
    expect(transport.last('ack').ok).toBe(false)
  })

  it.each(['disconnect', 'close', 'reset', 'release'] as const)('revokes phone control on %s and retains applied persistent settings', async (kind) => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    h.state.controls = { ...h.state.controls, throttle: .83, pitchTrim: .24, flaps: 2 / 3, elevator: .4, brake: 1 }
    if (kind === 'disconnect') h.session.disconnect()
    if (kind === 'close') transport.close()
    if (kind === 'reset') h.session.reset()
    if (kind === 'release') transport.receive({ v: 1, type: 'action', session: handoff.session, epoch: handoff.epoch, lease: handoff.lease, id: 2, action: 'releaseControl' })
    expect(h.session.getSnapshot().owner).toBe('local')
    expect(h.state.controls).toMatchObject({ throttle: .83, pitchTrim: .24, flaps: 2 / 3, elevator: 0, brake: 0 })
    expect(h.state.paused).toBe(kind !== 'reset')
  })

  it('preserves local flight on disconnect and clears listeners/timers on destroy', async () => {
    const h = setup()
    const transport = await h.pair()
    const updates = vi.fn()
    h.session.subscribe(updates)
    h.session.destroy()
    const updateCount = updates.mock.calls.length
    expect(h.pause).not.toHaveBeenCalled()
    expect(transport.reliableListeners.size + transport.nativeListeners.size + transport.closeListeners.size).toBe(0)
    const sent = transport.native.length
    await h.advance(30_000)
    h.endpoints[0].callbacks.onSignalingState!(false)
    expect(transport.native.length).toBe(sent)
    expect(updates).toHaveBeenCalledTimes(updateCount)
  })
})


describe('unsupported protocol versions', () => {
  it('rejects an incompatible hello with reload guidance and no opportunity to authenticate afterward', async () => {
    const h = setup()
    await h.session.startPairing()
    const secret = parsePairingUrl(h.session.getSnapshot().invitationUrl!)!.secret
    const transport = new Transport()
    h.endpoints[0].callbacks.onConnection!(transport)
    transport.receive({ v: 2, type: 'hello', secret })
    expect(transport.last('reject').reason).toBe(PROTOCOL_MISMATCH_MESSAGE)
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'invitation', owner: 'local', message: PROTOCOL_MISMATCH_MESSAGE })
    transport.receive({ v: 1, type: 'hello', secret })
    expect(transport.openNative).not.toHaveBeenCalled()
    await h.advance(100)
    expect(transport.closed).toBe(true)
    expect(h.ownership).not.toHaveBeenCalled()
    expect(h.pause).not.toHaveBeenCalled()
  })

  it.each(['reliable', 'native'] as const)('immediately revokes authority for an incompatible %s envelope and retains reload guidance after closure', async (channel) => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    const mismatch = { v: 2, type: 'controls', session: handoff.session, epoch: handoff.epoch }
    if (channel === 'reliable') transport.receive(mismatch)
    else transport.receiveNative(mismatch)
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'error', owner: 'local', message: PROTOCOL_MISMATCH_MESSAGE })
    expect(h.pause).toHaveBeenCalledWith(true)
    expect(transport.last('reject').reason).toBe(PROTOCOL_MISMATCH_MESSAGE)
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 100, lease: handoff.lease, controls: { ...handoff.controls, elevator: 1 } })
    expect(h.session.beforeStep(h.state.controls)).toMatchObject({ elevator: 0 })
    await h.advance(100)
    expect(transport.closed).toBe(true)
    expect(h.session.getSnapshot().message).toBe(PROTOCOL_MISMATCH_MESSAGE)
  })

  it('cancels the bounded rejection timer on teardown without later state changes', async () => {
    const h = setup()
    const transport = await h.pair()
    transport.receive({ v: 2, type: 'ready' })
    h.session.destroy()
    const closed = h.session.getSnapshot()
    await h.advance(200)
    expect(h.session.getSnapshot()).toBe(closed)
    expect(transport.closed).toBe(true)
  })
})


describe('reliable authority status recovery', () => {
  it('retries a backpressured takeover with the freshest applied state', async () => {
    const h = setup()
    const transport = await h.pair()
    h.grant(transport)
    let statusAttempts = 0
    transport.sendReliable.mockImplementation(value => {
      const message = value as RemoteMessage
      if (message.type === 'status' && ++statusAttempts === 1) return false
      transport.reliable.push(message)
      return true
    })
    h.session.takeControl()
    expect(statusAttempts).toBe(1)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'computer' })
    h.state.controls.throttle = .91
    await h.advance(50)
    expect(statusAttempts).toBe(2)
    expect(transport.last('status')).toMatchObject({ status: { owner: 'phone', blend: 'computer', controls: { throttle: .91 } } })
    await h.advance(200)
    expect(statusAttempts).toBe(2)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('coalesces retries and terminates a permanently blocked status with an actionable error', async () => {
    const h = setup()
    const transport = await h.pair()
    h.grant(transport)
    let statusAttempts = 0
    transport.sendReliable.mockImplementation(value => {
      if ((value as RemoteMessage).type === 'status') { statusAttempts += 1; return false }
      return true
    })
    h.session.takeControl()
    h.session.syncStatus()
    await h.advance(50)
    h.session.syncStatus()
    for (let tick = 0; tick < 10; tick++) await h.advance(50)
    expect(statusAttempts).toBe(9)
    expect(transport.closed).toBe(true)
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'error', owner: 'local', message: 'Could not synchronize phone controls. Scan a new QR to reconnect.' })
    const attempts = statusAttempts
    await h.advance(1000)
    expect(statusAttempts).toBe(attempts)
  })

  it('clears an older retry when the next epoch handoff is granted', async () => {
    const h = setup()
    const transport = await h.pair()
    h.grant(transport)
    transport.sendReliable.mockImplementation(value => {
      const message = value as RemoteMessage
      if (message.type === 'status') return false
      transport.reliable.push(message)
      return true
    })
    h.session.reset()
    await h.advance(50)
    h.grant(transport, 2)
    expect(h.session.getSnapshot().owner).toBe('phone')
    const statusAttempts = transport.sendReliable.mock.calls.filter(([value]) => (value as RemoteMessage).type === 'status').length
    await h.advance(100)
    expect(transport.sendReliable.mock.calls.filter(([value]) => (value as RemoteMessage).type === 'status')).toHaveLength(statusAttempts)
    expect(h.session.getSnapshot().owner).toBe('phone')
  })

  it('supersedes an unsent status with a successful authoritative acknowledgement', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    let failStatus = true
    transport.sendReliable.mockImplementation(value => {
      const message = value as RemoteMessage
      if (message.type === 'status' && failStatus) return false
      transport.reliable.push(message)
      return true
    })
    h.session.syncStatus()
    // An invalid lease produces a current-state acknowledgement, which replaces
    // the earlier synchronization attempt without creating another status.
    transport.receive({ v: 1, type: 'action', session: handoff.session, epoch: handoff.epoch, lease: 999999, id: 2, action: 'setPaused', value: true })
    expect(transport.last('ack')).toMatchObject({ ok: false, status: { owner: 'phone' } })
    failStatus = false
    const sent = transport.reliable.length
    await h.advance(50)
    expect(transport.reliable).toHaveLength(sent)
  })

  it('cancels status retries on destroy without later sends or state changes', async () => {
    const h = setup()
    const transport = await h.pair()
    transport.sendReliable.mockReturnValue(false)
    h.session.syncStatus()
    h.session.destroy()
    const sent = transport.sendReliable.mock.calls.length
    const closed = h.session.getSnapshot()
    await h.advance(1000)
    expect(transport.sendReliable).toHaveBeenCalledTimes(sent)
    expect(h.session.getSnapshot()).toBe(closed)
  })
})

describe('shared input priority and connection lifetime', () => {
  const offered = (transport: Transport) => transport.native
    .findLast((message): message is Extract<RemoteMessage, { type: 'heartbeat' }> => message.type === 'heartbeat' && message.status !== undefined)
    ?.status?.handBack
  const action = (transport: Transport, name: 'setPriority' | 'requestControl' | 'releaseControl', id: number, value?: 'phone' | 'computer') => {
    const heartbeat = transport.last('heartbeat')
    const handoff = transport.last('handoff')
    const current = heartbeat.epoch === handoff.epoch ? heartbeat : handoff
    transport.receive({ v: 1, type: 'action', session: current.session, epoch: current.epoch, lease: current.lease, id, action: name, ...(value === undefined ? {} : { value }) })
  }

  it.each(['auto', 'stay', 'phone', 'computer'] as const)('keeps local keys and the phone live regardless of retired %s policy', async handover => {
    const h = setup()
    h.setSharing({ mode: 'exclusive', handover })
    h.setLocalActive(true)
    const transport = await h.pair()
    const handoff = h.grant(transport)
    h.session.noteLocalInput()
    await h.advance(100)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'phone', returning: false })
    expect(h.session.isBlending()).toBe(true)
    expect(transport.last('heartbeat').epoch).toBe(handoff.epoch)
    expect(h.ownership).toHaveBeenCalledTimes(1)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('changes priority from either device without a new grant, epoch, pause or ownership callback', async () => {
    let selected: 'phone' | 'computer' = 'computer'
    const persist = vi.fn((priority: 'phone' | 'computer') => { selected = priority })
    const h = setup({ getSharing: () => ({ ...DEFAULT_CONTROL_SHARING, priority: selected }), setPriority: persist })
    const transport = await h.pair()
    const handoff = h.grant(transport)
    expect(selected).toBe('phone')
    h.session.takeControl()
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'computer' })
    expect(transport.last('status')).toMatchObject({ epoch: handoff.epoch, status: { owner: 'phone', blend: 'computer' } })
    action(transport, 'setPriority', 2, 'phone')
    expect(transport.last('ack')).toMatchObject({ id: 2, ok: true, epoch: handoff.epoch, status: { blend: 'phone' } })
    action(transport, 'setPriority', 3, 'computer')
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'computer' })
    expect(transport.reliable.filter(message => message.type === 'granted')).toHaveLength(1)
    expect(h.ownership).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls.map(([priority]) => priority)).toEqual(['phone', 'computer', 'phone', 'computer'])
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('keeps the latest computer priority choice made during the initial phone handoff', async () => {
    const activeLocalInput = vi.fn(() => true)
    const h = setup({ hasActiveLocalInput: activeLocalInput })
    h.state.controls.elevator = .7
    const transport = await h.pair()
    const handoff = h.requestControl(transport)
    h.session.takeControl()
    h.session.noteLocalInput()
    await h.advance(50)
    transport.receive({ v: 1, type: 'handoffAck', session: handoff.session, epoch: handoff.epoch, requestId: handoff.requestId })
    transport.receiveNative({ v: 1, type: 'controls', session: handoff.session, epoch: handoff.epoch, seq: 0, lease: handoff.lease, controls: handoff.controls })
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'computer' })
    expect(transport.last('granted')).toMatchObject({ epoch: handoff.epoch, status: { blend: 'computer' } })
    expect(activeLocalInput()).toBe(true)
    expect(h.ownership).toHaveBeenCalledWith('phone', handoff.controls, true)
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('accepts an older controller request as a priority selection and deduplicates it', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    h.session.takeControl()
    action(transport, 'requestControl', 2)
    action(transport, 'requestControl', 2)
    expect(transport.last('ack')).toMatchObject({ id: 2, ok: true, epoch: handoff.epoch, status: { blend: 'phone' } })
    expect(h.ownership).toHaveBeenCalledTimes(1)
    expect(transport.reliable.filter(message => message.type === 'handoff')).toHaveLength(1)
  })

  it('pauses a hidden host while retaining the phone and its epoch, then lets the phone resume', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    h.setVisible(false)
    h.session.onHidden()
    await h.advance(100)
    expect(h.state.paused).toBe(true)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', returning: false })
    expect(offered(transport)).toBeUndefined()
    expect(h.session.beforeStep(h.state.controls)).toBe(false)
    h.setVisible(true)
    const heartbeat = transport.last('heartbeat')
    transport.receiveNative({ ...heartbeat, type: 'controls', seq: 1, controls: handoff.controls })
    transport.receive({ ...heartbeat, type: 'action', id: 2, action: 'setPaused', value: false })
    expect(h.state.paused).toBe(false)
    expect(transport.last('ack')).toMatchObject({ ok: true, epoch: handoff.epoch })
    expect(h.ownership).toHaveBeenCalledTimes(1)
  })

  it('retains a chosen pause through priority changes', async () => {
    const h = setup()
    const transport = await h.pair()
    h.grant(transport)
    h.state.paused = true
    h.session.takeControl()
    action(transport, 'setPriority', 2, 'phone')
    expect(h.state.paused).toBe(true)
    expect(h.session.getSnapshot().owner).toBe('phone')
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('expires only after five total seconds of silence and offers a fresh handoff on recovery', async () => {
    const h = setup()
    h.setSharing({ holdMs: 0, handover: 'computer' })
    const transport = await h.pair()
    const first = h.grant(transport)
    h.session.takeControl()
    await h.advance(5000)
    expect(h.session.getSnapshot().owner).toBe('phone')
    await h.advance(50)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'local', returning: true })
    expect(h.session.isBlending()).toBe(false)
    expect(h.pause).not.toHaveBeenCalled()
    await h.advance(50)
    expect(offered(transport)).toBe('now')
    const recovered = h.grant(transport, 2)
    expect(recovered.epoch).toBeGreaterThan(first.epoch)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'computer' })
  })

  it('does not renew participation from malformed controls, stale leases or priority actions', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    for (let tick = 1; tick <= 100; tick++) {
      await h.advance(50)
      const heartbeat = transport.last('heartbeat')
      transport.receiveNative({ ...heartbeat, type: 'controls', seq: tick, controls: { ...handoff.controls, rudder: 2 } })
      transport.receiveNative({ ...heartbeat, type: 'controls', seq: tick, lease: handoff.lease, controls: handoff.controls })
      action(transport, 'setPriority', tick + 1, tick % 2 ? 'computer' : 'phone')
    }
    // The old lease was still valid for its first 250 ms; after that no input is accepted.
    await h.advance(350)
    expect(h.session.getSnapshot().owner).toBe('local')
    expect(h.pause).not.toHaveBeenCalled()
  })

  it('a voluntary release ends participation and prevents automatic hand-back', async () => {
    const h = setup()
    const transport = await h.pair()
    h.grant(transport)
    action(transport, 'releaseControl', 2)
    await h.advance(100)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'local', returning: false })
    expect(offered(transport)).toBeUndefined()
    expect(h.state.paused).toBe(true)
  })

  it('follows priority settings live without evicting the phone', async () => {
    const h = setup()
    const transport = await h.pair()
    const handoff = h.grant(transport)
    h.setSharing({ mode: 'exclusive', handover: 'computer', priority: 'computer' })
    await h.advance(100)
    expect(h.session.getSnapshot()).toMatchObject({ owner: 'phone', priority: 'computer' })
    expect(transport.last('status')).toMatchObject({ epoch: handoff.epoch, status: { owner: 'phone', blend: 'computer' } })
    expect(transport.native.findLast(message => message.type === 'heartbeat' && message.status)).toMatchObject({ epoch: handoff.epoch, status: { blend: 'computer' } })
    expect(h.ownership).toHaveBeenCalledTimes(1)
  })
})
