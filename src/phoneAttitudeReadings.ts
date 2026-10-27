import type { PhoneAttitude } from './protocol'

/** The readings drawn over one pad's attitude indicator. */
export interface PhoneAttitudeReadings {
  draw(attitude: PhoneAttitude): void
  destroy(): void
}

type Reading = 'ias' | 'hdg' | 'vs' | 'aoa' | 'alt'
const LABELS: Record<Reading, [label: string, unit: string]> = {
  ias: ['IAS', 'kt'], hdg: ['HDG', '°'], vs: ['VS', 'fpm'], aoa: ['AOA', '°'], alt: ['ALT', 'ft'],
}

/**
 * The readings the flight's Compact layout writes on its attitude indicator's
 * corners, written on the pad's: airspeed top left, heading top centre,
 * vertical speed top right, angle of attack bottom left and altitude bottom
 * right. They are the flight's own chips (`flight-hud__tape`), written and
 * tinted as `fly/src/flight/hud/flightHud.ts` does, so the two screens read
 * alike. Each frame edits text nodes in place, and only where a number changed.
 */
export function mountPhoneAttitudeReadings(host: HTMLElement): PhoneAttitudeReadings {
  const document = host.ownerDocument
  const tapes = {} as Record<Reading, { element: HTMLElement; text: Text }>
  for (const reading of Object.keys(LABELS) as Reading[]) {
    const [label, unit] = LABELS[reading]
    const element = document.createElement('div')
    element.className = 'flight-hud__tape'
    element.dataset.reading = reading
    const header = document.createElement('div')
    header.className = 'flight-hud__tape-header'
    const labelElement = document.createElement('span')
    labelElement.className = 'flight-hud__label'
    labelElement.textContent = label
    const unitElement = document.createElement('span')
    unitElement.className = 'flight-hud__unit'
    unitElement.textContent = unit
    header.append(labelElement, unitElement)
    const value = document.createElement('span')
    value.className = 'flight-hud__value'
    const text = document.createTextNode('')
    value.append(text)
    element.append(header, value)
    tapes[reading] = { element, text }
  }
  host.replaceChildren(...Object.values(tapes).map(tape => tape.element))

  const write = (reading: Reading, value: string | null) => {
    const { element, text } = tapes[reading]
    if (element.hidden !== (value === null)) element.hidden = value === null
    if (value !== null && text.data !== value) text.data = value
  }
  const tint = (reading: 'ias' | 'aoa', value: number | undefined) => {
    const { element } = tapes[reading]
    const step = value === undefined ? '' : value.toFixed(2)
    if ((element.dataset.tint ?? '') === step) return
    if (step === '') {
      delete element.dataset.tint
      element.style.removeProperty('--hud-tint')
    } else {
      element.dataset.tint = step
      element.style.setProperty('--hud-tint', step)
    }
  }
  // Signed: brown descending, blue climbing, dark ink until the fill is darker than mid grey.
  const tintVs = (value: number | undefined) => {
    const { element } = tapes.vs
    const step = value === undefined ? '' : value.toFixed(2)
    if ((element.dataset.vsTint ?? '') === step) return
    if (step === '') {
      delete element.dataset.vsTint
      delete element.dataset.vsDirection
      delete element.dataset.vsInk
      element.style.removeProperty('--hud-vs-mix')
      return
    }
    const mix = Math.abs(Number(step))
    element.dataset.vsTint = step
    element.dataset.vsDirection = step.startsWith('-') ? 'down' : 'up'
    element.dataset.vsInk = mix < 0.6 ? 'dark' : 'light'
    element.style.setProperty('--hud-vs-mix', mix.toFixed(2))
  }

  return {
    draw(attitude) {
      const headingDeg = ((Math.round(attitude.headingRad * 180 / Math.PI) % 360) + 360) % 360
      write('hdg', String(headingDeg).padStart(3, '0'))
      const vsFpm = Math.round(attitude.verticalSpeedFps * 60)
      write('vs', `${vsFpm < 0 ? '-' : '+'}${String(Math.abs(vsFpm)).padStart(4, ' ')}`)
      // A computer that sends no readings leaves them to the chips under the pad.
      const readings = attitude.readings
      write('ias', readings ? String(Math.round(readings.iasKt)).padStart(3, '0') : null)
      write('aoa', readings?.aoaDeg === undefined ? null : readings.aoaDeg.toFixed(1).padStart(4, ' '))
      write('alt', !readings ? null : readings.altitudeFt === undefined ? '—' : String(Math.round(readings.altitudeFt)))
      tint('ias', readings?.tints?.ias)
      tint('aoa', readings?.tints?.aoa)
      tintVs(readings?.tints?.vs)
    },
    destroy() { host.replaceChildren() },
  }
}
