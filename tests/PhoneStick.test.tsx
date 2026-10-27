// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhoneBrake, PhoneCameraPad, PhoneStick } from '../src/PhoneStick'
import { inverseStickResponse, stickResponse, type PhoneAttitudeInstrument } from '../src/phoneAttitudeInstrument'
import type { PhoneAttitude } from '../src/protocol'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, toJSON: () => ({}) })
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
/** Pointer-driven changes carry when their touch happened, for the opt-in camera trace. */
const timed = expect.objectContaining({ at: expect.any(Number) })
function pointer(element: Element, type: string, id: number, x = 100, y = 100) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0 })
  act(() => element.dispatchEvent(event))
}

describe('phone touch controls', () => {
  it('keeps independent stick pointers, clamps the pad, and centers only the cancelled pointer', () => {
    const right = vi.fn()
    const left = vi.fn()
    act(() => root.render(<><PhoneStick label="Pitch/roll" disabled={false} onChange={right} /><PhoneStick label="Rudder" horizontal disabled={false} onChange={left} /></>))
    const [pitch, rudder] = container.querySelectorAll('button')
    pointer(pitch, 'pointerdown', 1, 100, 100)
    pointer(pitch, 'pointermove', 1, 400, 100)
    expect(right).toHaveBeenLastCalledWith(1, 0, timed)
    pointer(rudder, 'pointerdown', 2, 0, 180)
    expect(left).toHaveBeenLastCalledWith(-1, 0, timed)
    pointer(pitch, 'pointermove', 2, 0, 0)
    expect(right).toHaveBeenLastCalledWith(1, 0, timed)
    pointer(pitch, 'pointercancel', 1)
    expect(right).toHaveBeenLastCalledWith(0, 0)
    expect(left).toHaveBeenLastCalledWith(-1, 0, timed)
    pointer(rudder, 'lostpointercapture', 2)
    expect(left).toHaveBeenLastCalledWith(0, 0)
  })

  it('centers on rotation, disable and unmount; brake releases on lost capture and ignores disabled input', () => {
    const stick = vi.fn()
    const brake = vi.fn()
    const render = (disabled: boolean) => act(() => root.render(<><PhoneStick label="Pitch/roll" disabled={disabled} onChange={stick} /><PhoneBrake disabled={disabled} onChange={brake} /></>))
    render(false)
    const [pad, button] = container.querySelectorAll('button')
    pointer(pad, 'pointerdown', 1, 100, 0)
    pointer(button, 'pointerdown', 2)
    expect(stick).toHaveBeenLastCalledWith(0, -1, timed)
    expect(brake).toHaveBeenLastCalledWith(true)
    pointer(button, 'lostpointercapture', 2)
    expect(brake).toHaveBeenLastCalledWith(false)
    act(() => window.dispatchEvent(new Event('orientationchange')))
    expect(stick).toHaveBeenLastCalledWith(0, 0)
    pointer(button, 'pointerdown', 3)
    render(true)
    expect(brake).toHaveBeenLastCalledWith(false)
    pointer(button, 'pointerdown', 4)
    expect(brake).toHaveBeenLastCalledWith(false)
    render(false)
    pointer(pad, 'pointerdown', 5, 100, 0)
    act(() => root.render(null))
    expect(stick).toHaveBeenLastCalledWith(0, 0)
  })

  it('moves the stick knob the whole deflection radius, not a fraction of itself', () => {
    const stick = vi.fn()
    act(() => root.render(<PhoneStick label="Pitch/roll" disabled={false} onChange={stick} />))
    const pad = container.querySelector('button')!
    const knob = container.querySelector<HTMLElement>('.phone-stick__knob')!
    // Full right deflection on a 200px pad: the ring sits at the radius the pad
    // reads deflection from, 72px, not at 70% of the knob's own 52px.
    pointer(pad, 'pointerdown', 1, 200, 100)
    expect(stick).toHaveBeenLastCalledWith(1, 0, timed)
    expect(knob.style.transform).toBe('translate(72px, 0px)')
    pointer(pad, 'pointerup', 1)
    expect(knob.style.transform).toBe('translate(0px, 0px)')
    // One circle, no needle inside it.
    expect(knob.children).toHaveLength(0)
  })

  it('reads the camera pad as swipes and pinches rather than a position', () => {
    const gesture = vi.fn()
    act(() => root.render(<PhoneCameraPad disabled={false} onGesture={gesture} twoFingers="zoom" />))
    const pad = container.querySelector('button')!
    expect(pad.className).toBe('phone-camera')
    // Not a flight control: it must not tell anyone to raise the nose.
    expect(container.textContent).not.toContain('NOSE')

    // Touching reports nothing: a trackpad has no position to send.
    pointer(pad, 'pointerdown', 1, 100, 100)
    expect(gesture).not.toHaveBeenCalled()
    pointer(pad, 'pointermove', 1, 130, 90)
    expect(gesture).toHaveBeenLastCalledWith({ yaw: .03, pitch: -.01 }, timed)
    // Deltas, not absolutes: a finger that has not moved moves no camera.
    gesture.mockClear()
    pointer(pad, 'pointermove', 1, 130, 90)
    expect(gesture).not.toHaveBeenCalled()

    // With Zoom only, a second finger turns the gesture into a pinch, and only a pinch.
    pointer(pad, 'pointerdown', 2, 230, 90)
    expect(gesture).not.toHaveBeenCalled()
    pointer(pad, 'pointermove', 2, 280, 90)
    expect(gesture).toHaveBeenCalledTimes(1)
    expect(gesture).toHaveBeenLastCalledWith({ yaw: 0, pitch: 0, zoom: 1.5 }, timed)

    // Lifting one finger resumes swiping from where the other one is.
    pointer(pad, 'pointerup', 2)
    gesture.mockClear()
    pointer(pad, 'pointermove', 1, 140, 90)
    expect(gesture).toHaveBeenLastCalledWith({ yaw: .01, pitch: 0 }, timed)
  })

  it('turns the view with the point between two fingers while their spread zooms, by default', () => {
    const gesture = vi.fn()
    act(() => root.render(<PhoneCameraPad disabled={false} onGesture={gesture} />))
    const pad = container.querySelector('button')!
    const moved = () => gesture.mock.calls.reduce((total, [move]) => ({
      yaw: total.yaw + move.yaw, pitch: total.pitch + move.pitch, zoom: total.zoom * (move.zoom ?? 1),
    }), { yaw: 0, pitch: 0, zoom: 1 })
    pointer(pad, 'pointerdown', 1, 100, 100)
    pointer(pad, 'pointerdown', 2, 200, 100)
    // Both 20 px right and 10 px down, one after the other as a phone reports
    // them: the view turns as far as one finger would turn it, and does not zoom.
    pointer(pad, 'pointermove', 1, 120, 110)
    pointer(pad, 'pointermove', 2, 220, 110)
    expect(moved().yaw).toBeCloseTo(.02, 12)
    expect(moved().pitch).toBeCloseTo(.01, 12)
    expect(moved().zoom).toBeCloseTo(1, 12)
    // One spreads 50 px away: a zoom, and the point between them turns the view half as far.
    pointer(pad, 'pointermove', 2, 270, 110)
    expect(gesture).toHaveBeenLastCalledWith({ yaw: .025, pitch: 0, zoom: 1.5 }, timed)
    // Lifting one finger swipes on from where the other one is, at a finger's rate.
    pointer(pad, 'pointerup', 1)
    pointer(pad, 'pointermove', 2, 280, 110)
    expect(gesture).toHaveBeenLastCalledWith({ yaw: .01, pitch: 0 }, timed)
  })

  it('reports how many fingers are on the camera pad each time that changes', () => {
    const fingers = vi.fn()
    act(() => root.render(<PhoneCameraPad disabled={false} onGesture={vi.fn()} onFingers={fingers} />))
    const pad = container.querySelector('button')!
    const counts = () => fingers.mock.calls.map(([count]) => count)
    pointer(pad, 'pointerdown', 1)
    expect(fingers).toHaveBeenLastCalledWith(1, timed)
    pointer(pad, 'pointerdown', 2, 150, 100)
    // A moving finger changes no count, and a third is not the pad's.
    pointer(pad, 'pointermove', 2, 160, 100)
    pointer(pad, 'pointerdown', 3, 50, 50)
    expect(counts()).toEqual([1, 2])
    pointer(pad, 'pointerup', 2)
    expect(fingers).toHaveBeenLastCalledWith(1, timed)
    // The capture a lift loses is the same lift.
    pointer(pad, 'lostpointercapture', 2)
    pointer(pad, 'pointercancel', 1)
    expect(counts()).toEqual([1, 2, 1, 0])

    // Fingers the page stops tracking lift with no touch to time them by.
    pointer(pad, 'pointerdown', 1)
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(fingers).toHaveBeenLastCalledWith(0)
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(counts()).toEqual([1, 2, 1, 0, 1, 0])
    pointer(pad, 'pointerdown', 1)
    act(() => root.render(<PhoneCameraPad disabled onGesture={vi.fn()} onFingers={fingers} />))
    expect(counts()).toEqual([1, 2, 1, 0, 1, 0, 1, 0])
  })
})

describe('attitude indicator in the pitch/roll pad', () => {
  it('stays plain until the computer sends an attitude, then draws it once a frame and steers as the flight pad does', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const paint = () => act(() => { for (const callback of frames.splice(0)) callback(0) })
    let attitude: PhoneAttitude | null = null
    const listeners = new Set<() => void>()
    const source = {
      getAttitude: () => attitude,
      subscribeAttitude: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
    const send = (next: PhoneAttitude) => act(() => { attitude = next; for (const listener of listeners) listener() })
    const draw = vi.fn()
    const destroy = vi.fn()
    const mount = vi.fn<(host: HTMLElement) => PhoneAttitudeInstrument>(() => ({ draw, destroy }))
    const instrument = { renderer: { halfShare: .5, mount }, source }
    const stick = vi.fn()
    act(() => root.render(<PhoneStick label="Pitch/roll" disabled={false} onChange={stick} instrument={instrument} />))
    const pad = container.querySelector('button')!
    // A computer that sends no attitude leaves the pad as it was.
    expect(pad.classList).not.toContain('phone-stick--attitude')
    expect(mount).not.toHaveBeenCalled()

    const level = { rollRad: 0, pitchRad: .05, headingRad: 1, northVelocityFps: 100, eastVelocityFps: 0, verticalSpeedFps: 0, aileron: 0, elevator: 0 }
    send(level)
    expect(pad.classList).toContain('phone-stick--attitude')
    expect(mount).toHaveBeenCalledWith(container.querySelector('.phone-stick__instrument'))
    paint()
    expect(draw).toHaveBeenLastCalledWith(level, { x: 0, y: 0, active: false })

    // However many arrive in a frame, it draws the last one, once.
    draw.mockClear()
    send({ ...level, rollRad: .1 })
    send({ ...level, rollRad: .2 })
    paint()
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw).toHaveBeenLastCalledWith({ ...level, rollRad: .2 }, { x: 0, y: 0, active: false })

    // Full deflection at the instrument's edge, 100px on a 200px pad, and
    // each axis on its own: a corner is full roll and full pitch, not 71% of each.
    pointer(pad, 'pointerdown', 1, 200, 0)
    expect(stick).toHaveBeenLastCalledWith(1, -1, timed)
    paint()
    expect(draw).toHaveBeenLastCalledWith(expect.anything(), { x: 1, y: -1, active: true })
    pointer(pad, 'pointermove', 1, 150, 100)
    expect(stick).toHaveBeenLastCalledWith(stickResponse(.5), 0, timed)
    pointer(pad, 'pointerup', 1)

    // Let go, it shows where the aircraft's controls are, as the flight's pad does.
    send({ ...level, aileron: .25, elevator: -.5 })
    paint()
    expect(draw).toHaveBeenLastCalledWith(expect.anything(), { x: inverseStickResponse(.25), y: inverseStickResponse(.5), active: true })

    act(() => root.render(null))
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })
})
