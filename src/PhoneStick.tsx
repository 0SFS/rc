import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type PointerEvent } from 'react'
import type { InputTiming, PhoneControllerClient } from './phoneControllerClient'
import type { PhoneControllerSettings } from './protocol'
import { type PhoneAttitudeInstrument, type PhoneAttitudeRenderer } from './phoneAttitudeInstrument'
import { mountCenteredStick, inverseStickResponse, stickResponse } from '@0sfs/controls/centeredStick'
import { mountPhoneAttitudeReadings, type PhoneAttitudeReadings } from './phoneAttitudeReadings'

/** The flight's attitude indicator for the pad, and where its attitude comes from. */
export interface PhoneStickInstrument {
  renderer: PhoneAttitudeRenderer
  source: Pick<PhoneControllerClient, 'getAttitude' | 'subscribeAttitude'>
}

interface PhoneStickProps {
  label: string; horizontal?: boolean; disabled: boolean; onChange(x: number, y: number, input?: InputTiming): void
  /**
   * Draws the flight's attitude indicator in the pad once the computer sends
   * an attitude, with its readings on the corners, and moves the stick as the
   * flight's own pad does: full deflection at the instrument's edge, each axis
   * on its own.
   */
  verticalLabels?: { up: string; down: string }
  instrument?: PhoneStickInstrument
  children?: ReactNode
  className?: string
  square?: boolean
  halfShare?: number
}

/** When the touch behind a change happened, for the opt-in camera trace. */
function timing(event: PointerEvent<HTMLElement>): InputTiming {
  return { at: event.timeStamp, coalesced: () => event.nativeEvent.getCoalescedEvents?.().length || 1 }
}

/**
 * The deflection ring: how far from centre counts as full travel. The knob is
 * drawn at that same radius, so it sits under the finger rather than lagging
 * behind it.
 */
const TRAVEL = .36

/** One captured pointer per pad; separate pads can operate simultaneously. */
export function PhoneStick({ label, horizontal = false, disabled, onChange, instrument, verticalLabels, children, className = '', square = false, halfShare }: PhoneStickProps) {
  const surface = useRef<HTMLButtonElement>(null)
  const knob = useRef<HTMLSpanElement>(null)
  const binding = useRef<ReturnType<typeof mountCenteredStick> | null>(null)
  const latest = useRef({ disabled, onChange })
  const { host: instrumentHost, readingsHost, shown: attitudeShown, setFinger } = useAttitudeInstrument(instrument)
  const travelShare = halfShare ?? (attitudeShown && instrument ? instrument.renderer.halfShare : TRAVEL)
  useLayoutEffect(() => { latest.current = { disabled, onChange } })
  useEffect(() => {
    const pad = surface.current!
    const stick = mountCenteredStick(pad, {
      halfShare: travelShare, horizontal,
      square: () => square || attitudeShown,
      disabled: () => latest.current.disabled,
      onChange: (x, y, input) => {
        if (input) latest.current.onChange(stickResponse(x), horizontal ? 0 : stickResponse(y), input)
        else latest.current.onChange(stickResponse(x), horizontal ? 0 : stickResponse(y))
      },
      onPosition: (x, y, held) => {
        const rect = pad.getBoundingClientRect()
        const radius = Math.max(1, Math.min(rect.width, horizontal ? rect.width : rect.height) * travelShare)
        if (knob.current) knob.current.style.transform = `translate(${x * radius}px, ${y * radius}px)`
        setFinger(x, y, held)
      },
    })
    binding.current = stick
    return () => { stick.destroy(); binding.current = null }
  }, [travelShare, horizontal, square, attitudeShown, setFinger])
  useEffect(() => { if (disabled) binding.current?.release() }, [disabled])
  return <button ref={surface} type="button"
    className={`phone-stick${horizontal ? ' phone-stick--rudder' : ''}${attitudeShown ? ' phone-stick--attitude' : ''}${className ? ` ${className}` : ''}`}
    aria-label={`${label}. Drag to steer; arrow keys also work.`} disabled={disabled}>
    {instrument && <span className="phone-stick__instrument" ref={instrumentHost} aria-hidden="true" />}
    {instrument && <span className="phone-stick__readings flight-hud__attitude-readings" ref={readingsHost} aria-hidden="true" />}
    {children}
    <span className="phone-stick__cross" aria-hidden="true" />
    <span className="phone-stick__knob" ref={knob} aria-hidden="true" />
    <span className="phone-stick__label">{label}</span>
    {!horizontal && <><span className="phone-stick__top">{verticalLabels?.up ?? "NOSE DOWN"}</span><span className="phone-stick__bottom">{verticalLabels?.down ?? "NOSE UP"}</span></>}
    <span className="phone-stick__left" aria-hidden="true">←</span><span className="phone-stick__right" aria-hidden="true">→</span>
  </button>
}

/**
 * Mounts the flight's attitude indicator in the pad, and its readings over it,
 * and draws them whenever an attitude arrives or the finger moves, once a
 * frame at most. Until the first
 * attitude the pad stays plain: a computer that sends none leaves it so. The
 * stick it draws is the finger while one holds the pad, and otherwise where
 * the aircraft's controls are, as the flight's own pad shows them.
 */
function useAttitudeInstrument(instrument: PhoneStickInstrument | undefined) {
  const host = useRef<HTMLSpanElement>(null)
  const readingsHost = useRef<HTMLSpanElement>(null)
  const drawn = useRef<PhoneAttitudeInstrument | null>(null)
  const readings = useRef<PhoneAttitudeReadings | null>(null)
  const finger = useRef({ x: 0, y: 0, held: false })
  const frame = useRef<number | null>(null)
  const source = instrument?.source
  // One render when the first attitude arrives, never one per attitude.
  const arrived = useSyncExternalStore(source?.subscribeAttitude ?? noSubscription, () => source?.getAttitude() != null)
  const shown = instrument !== undefined && arrived
  const draw = useCallback(() => {
    frame.current = null
    const attitude = source?.getAttitude()
    if (!attitude || !drawn.current) return
    const { x, y, held } = finger.current
    const rest = { x: inverseStickResponse(attitude.aileron), y: inverseStickResponse(-attitude.elevator) }
    drawn.current.draw(attitude, held ? { x, y, active: true }
      : { ...rest, active: Math.hypot(attitude.aileron, attitude.elevator) > .001 })
    readings.current?.draw(attitude)
  }, [source])
  const schedule = useCallback(() => {
    if (frame.current !== null) return
    if (typeof requestAnimationFrame !== 'function') { draw(); return }
    frame.current = requestAnimationFrame(draw)
  }, [draw])
  useEffect(() => {
    if (!instrument || !shown || !host.current) return
    drawn.current = instrument.renderer.mount(host.current)
    if (readingsHost.current) readings.current = mountPhoneAttitudeReadings(readingsHost.current)
    schedule()
    const unsubscribe = instrument.source.subscribeAttitude(schedule)
    return () => {
      unsubscribe()
      if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current)
      frame.current = null
      drawn.current?.destroy()
      drawn.current = null
      readings.current?.destroy()
      readings.current = null
    }
  }, [instrument, shown, schedule])
  const setFinger = useCallback((x: number, y: number, held: boolean) => {
    finger.current = { x, y, held }
    if (drawn.current) schedule()
  }, [schedule])
  return { host, readingsHost, shown, setFinger }
}
const noSubscription = () => () => {}

export function PhoneBrake({ disabled, onChange }: { disabled: boolean; onChange(held: boolean): void }) {
  const button = useRef<HTMLButtonElement>(null)
  const pointer = useRef<number | null>(null)
  const release = useCallback(() => {
    const id = pointer.current
    pointer.current = null
    if (id !== null && button.current?.hasPointerCapture?.(id)) button.current.releasePointerCapture(id)
    button.current?.removeAttribute('data-active')
    onChange(false)
  }, [onChange])
  useEffect(() => { if (disabled) release() }, [disabled, release])
  useEffect(() => {
    const hide = () => { if (document.hidden) release() }
    window.addEventListener('blur', release)
    window.addEventListener('orientationchange', release)
    window.addEventListener('resize', release)
    document.addEventListener('visibilitychange', hide)
    return () => {
      release()
      window.removeEventListener('blur', release)
      window.removeEventListener('orientationchange', release)
      window.removeEventListener('resize', release)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [release])
  return <button ref={button} type="button" className="phone-brake" disabled={disabled}
    onPointerDown={event => {
      if (disabled || pointer.current !== null || event.button !== 0) return
      event.preventDefault()
      pointer.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.setAttribute('data-active', '')
      onChange(true)
    }}
    onPointerUp={event => { if (event.pointerId === pointer.current) release() }}
    onPointerCancel={event => { if (event.pointerId === pointer.current) release() }}
    onLostPointerCapture={event => { if (event.pointerId === pointer.current) release() }}
    onKeyDown={event => { if (!disabled && (event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); onChange(true); event.currentTarget.setAttribute('data-active', '') } }}
    onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); release() } }}
    onBlur={release} onContextMenu={event => event.preventDefault()}
    aria-label="Brake. Hold to apply brakes." title="Hold to brake">B</button>
}

/**
 * A trackpad, not a stick: one finger swipes the view, two pinch to zoom.
 *
 * It reports what the fingers *just did* — movement in CSS pixels, scaled to
 * the wire's -1..1, and a pinch as the ratio the spread changed by. Nothing
 * here is a position, so there is no knob to draw and nothing to centre: let go
 * and the view stays where you put it, the way dragging the desktop canvas does.
 *
 * CSS pixels rather than a fraction of the pad, deliberately. They are already
 * density-independent, so a swipe of a given length turns the view by the same
 * amount on any phone and in either orientation — a fraction of the pad would
 * make the same finger movement mean different things in portrait and landscape.
 */
const GESTURE_SCALE = 1000
const KEY_STEP = 30 / GESTURE_SCALE
interface CameraGesture { yaw: number; pitch: number; zoom?: number }
interface PhoneCameraPadProps {
  disabled: boolean
  onGesture(gesture: CameraGesture, input?: InputTiming): void
  /**
   * How many fingers are on the pad, each time that changes, so the computer
   * can glide a swipe on when they lift and stop it when one lands.
   */
  onFingers?(count: number, input?: InputTiming): void
  /**
   * What two fingers do, ⚙ Settings → Camera pad: `both` turns the view with
   * the point between them while their spread zooms; `zoom` only zooms.
   */
  twoFingers?: PhoneControllerSettings['twoFingers']
}

export function PhoneCameraPad({ disabled, onGesture, onFingers, twoFingers = 'both' }: PhoneCameraPadProps) {
  const surface = useRef<HTMLButtonElement>(null)
  /** Every finger currently down, so a second one can start a pinch mid-swipe. */
  const points = useRef(new Map<number, { x: number; y: number }>())
  const spread = useRef<number | null>(null)
  // `release` stays one callback for the listeners it is registered with.
  const reportFingers = useRef(onFingers)
  useLayoutEffect(() => { reportFingers.current = onFingers })
  const release = useCallback(() => {
    for (const id of points.current.keys()) {
      if (surface.current?.hasPointerCapture?.(id)) surface.current.releasePointerCapture(id)
    }
    const held = points.current.size > 0
    points.current.clear()
    spread.current = null
    surface.current?.removeAttribute('data-active')
    if (held) reportFingers.current?.(0)
  }, [])
  useEffect(() => { if (disabled) release() }, [disabled, release])
  useEffect(() => {
    const hide = () => { if (document.hidden) release() }
    window.addEventListener('blur', release)
    window.addEventListener('orientationchange', release)
    window.addEventListener('resize', release)
    document.addEventListener('visibilitychange', hide)
    return () => {
      release()
      window.removeEventListener('blur', release)
      window.removeEventListener('orientationchange', release)
      window.removeEventListener('resize', release)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [release])
  const distance = (): number | null => {
    const [first, second] = [...points.current.values()]
    return second ? Math.hypot(first.x - second.x, first.y - second.y) : null
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const previous = points.current.get(event.pointerId)
    if (!previous || disabled) return
    event.preventDefault()
    const delta = { x: event.clientX - previous.x, y: event.clientY - previous.y }
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (points.current.size > 1) {
      const current = distance()
      const previousSpread = spread.current
      spread.current = current
      const zoom = current !== null && previousSpread !== null && previousSpread > 0 && current > 0 ? current / previousSpread : 1
      // The point between the fingers moves half as far as the one that moved,
      // so two moving together turn the view as far as one finger does. Zoom
      // only keeps two fingers a pinch, which then never turns it.
      const turn = twoFingers === 'both' ? .5 / GESTURE_SCALE : 0
      const gesture = { yaw: delta.x * turn, pitch: delta.y * turn }
      if (zoom !== 1 || gesture.yaw !== 0 || gesture.pitch !== 0) onGesture(zoom === 1 ? gesture : { ...gesture, zoom }, timing(event))
      return
    }
    if (delta.x === 0 && delta.y === 0) return
    onGesture({ yaw: delta.x / GESTURE_SCALE, pitch: delta.y / GESTURE_SCALE }, timing(event))
  }
  const lift = (event: PointerEvent<HTMLButtonElement>) => {
    if (!points.current.delete(event.pointerId)) return
    if (surface.current?.hasPointerCapture?.(event.pointerId)) surface.current.releasePointerCapture(event.pointerId)
    // The finger that stays keeps its last position, so dropping out of a pinch
    // continues the swipe from where it is instead of jumping.
    spread.current = distance()
    if (points.current.size === 0) surface.current?.removeAttribute('data-active')
    onFingers?.(points.current.size, timing(event))
  }
  return <button ref={surface} type="button" className="phone-camera" disabled={disabled}
    aria-label="Camera. Swipe to look around, pinch with two fingers to zoom; arrow keys also work."
    onPointerDown={event => {
      if (disabled || event.button !== 0 || points.current.size >= 2) return
      event.preventDefault()
      points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.setAttribute('data-active', '')
      spread.current = distance()
      onFingers?.(points.current.size, timing(event))
    }} onPointerMove={move}
    onPointerUp={lift} onPointerCancel={lift} onLostPointerCapture={lift}
    onKeyDown={event => {
      const step: Record<string, CameraGesture> = {
        ArrowLeft: { yaw: -KEY_STEP, pitch: 0 }, ArrowRight: { yaw: KEY_STEP, pitch: 0 },
        ArrowUp: { yaw: 0, pitch: -KEY_STEP }, ArrowDown: { yaw: 0, pitch: KEY_STEP },
      }
      const gesture = step[event.key]
      if (!gesture || disabled) return
      event.preventDefault()
      onGesture(gesture)
    }}
    onBlur={release} onContextMenu={event => event.preventDefault()}>
    <span className="phone-camera__label">CAMERA</span>
    <span className="phone-camera__hint" aria-hidden="true">SWIPE TO LOOK · PINCH TO ZOOM</span>
  </button>
}
