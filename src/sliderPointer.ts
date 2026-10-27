import type { PhoneControllerSettings } from './protocol'

export type SliderPress = PhoneControllerSettings['sliders']

export interface SliderPointerOptions {
  orientation: 'vertical' | 'horizontal'
  /** Settings → Sliders, read at each press. */
  press(): SliderPress
  /** A value the finger put the slider at, within its range and on its step. */
  onValue(value: number): void
  /** A finger has taken the slider. */
  onPress?(): void
  /** The finger that took it has let go, or the system took it away. */
  onRelease?(): void
}

/** How far from the handle's centre a press still lands on it, past its own radius. */
const GRAB_SLOP_PX = 10

/**
 * Drives a native range input from the pointer on `surface`, the box round
 * it, instead of leaving the drag to the browser. A browser that owns the drag
 * may take the pointer for itself as the drag begins — Safari on an iPhone
 * does — and then the release never comes, and a yaw slider that should spring
 * back stays deflected. Here the surface holds the pointer until it lifts, and
 * a press on the track does what Settings → Sliders says: jump the handle to
 * the finger (`jump`), or nothing unless it is on the handle, which then moves
 * as far as the finger does (`grab`). The keyboard still moves the input
 * natively. The input itself takes no pointer: `[data-slider-pointer]` in
 * flightControls.css.
 */
export function attachSliderPointer(surface: HTMLElement, input: HTMLInputElement, options: SliderPointerOptions): () => void {
  let drag: { pointerId: number; origin: number; originValue: number; jump: boolean } | null = null
  const vertical = options.orientation === 'vertical'
  const range = () => {
    const min = Number(input.min || 0)
    const max = Number(input.max || 100)
    const step = Number(input.step) || 1
    return { min, max: max > min ? max : min + 1, step }
  }
  // The native thumb's centre runs from half a thumb in from one end to half a thumb in from the other.
  const track = () => {
    const rect = input.getBoundingClientRect()
    const thumb = Number.parseFloat(getComputedStyle(surface).getPropertyValue('--control-thumb')) || 10
    const length = vertical ? rect.height : rect.width
    return { start: vertical ? rect.bottom - thumb / 2 : rect.left + thumb / 2, travel: Math.max(1, length - thumb), thumb }
  }
  /** Distance along the track, from its minimum end, of a pointer. */
  const along = (event: PointerEvent, start: number) => (vertical ? start - event.clientY : event.clientX - start)
  const valueAt = (fraction: number) => {
    const { min, max, step } = range()
    const raw = min + Math.min(1, Math.max(0, fraction)) * (max - min)
    // Fixed, so a step of .01 gives 0.12 rather than 0.12000000000000001.
    const stepped = Number((Math.round((raw - min) / step) * step + min).toFixed(6))
    return Math.min(max, Math.max(min, stepped))
  }
  const fractionOf = (value: number) => {
    const { min, max } = range()
    return (value - min) / (max - min)
  }
  const set = (value: number) => {
    if (Number.isFinite(value) && value !== Number(input.value)) options.onValue(value)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (drag || input.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    const { start, travel, thumb } = track()
    const at = along(event, start)
    const handle = fractionOf(Number(input.value)) * travel
    const onHandle = Math.abs(at - handle) <= thumb / 2 + GRAB_SLOP_PX
    const jump = options.press() === 'jump'
    if (!jump && !onHandle) return
    event.preventDefault()
    try { surface.setPointerCapture(event.pointerId) } catch { /* A pointer that already ended cannot be captured. */ }
    drag = { pointerId: event.pointerId, origin: at, originValue: Number(input.value), jump }
    options.onPress?.()
    if (jump) set(valueAt(at / travel))
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    const { start, travel } = track()
    const at = along(event, start)
    set(valueAt(drag.jump ? at / travel : fractionOf(drag.originValue) + (at - drag.origin) / travel))
  }
  const onPointerEnd = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    drag = null
    options.onRelease?.()
  }
  // A long press on a slider must not open a menu.
  const onContextMenu = (event: Event) => event.preventDefault()

  surface.dataset.sliderPointer = ''
  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerEnd)
  surface.addEventListener('pointercancel', onPointerEnd)
  surface.addEventListener('lostpointercapture', onPointerEnd)
  surface.addEventListener('contextmenu', onContextMenu)
  return () => {
    delete surface.dataset.sliderPointer
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerup', onPointerEnd)
    surface.removeEventListener('pointercancel', onPointerEnd)
    surface.removeEventListener('lostpointercapture', onPointerEnd)
    surface.removeEventListener('contextmenu', onContextMenu)
  }
}
