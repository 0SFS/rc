import { useEffect, useRef, useState } from 'react'
import { createBrowserDataPanel } from '@foss-earth/ui/browser'

/** The controller uses full-screen sheets so maintenance never covers its controls. */
export function PhoneBrowserData() {
  const host = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open || !host.current) return
    const panel = createBrowserDataPanel(host.current.ownerDocument)
    host.current.append(panel.element)
    return () => { panel.destroy(); panel.element.remove() }
  }, [open])
  return <details className="phone-sheet phone-browser-data" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label="Browser data">
      <span className="phone-sheet__chip" aria-hidden="true">Browser data</span>
      <span className="phone-sheet__title">Browser data</span>
    </summary>
    <div ref={host} />
  </details>
}
