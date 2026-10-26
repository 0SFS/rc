export type ControlPositionOrientation = "vertical" | "horizontal";

/** A native command thumb and a passive physical-position I-beam on the same track. */
export function mountNativeControlPosition(input: HTMLInputElement, orientation: ControlPositionOrientation) {
  const document = input.ownerDocument;
  const parent = input.parentElement;
  if (!parent) throw new Error("A control position input must be mounted.");
  const existing = parent.classList.contains("flight-control-position");
  const wrapper = existing ? parent : document.createElement("span");
  if (!existing) {
    wrapper.className = `flight-control-position flight-control-position--${orientation}`;
    input.replaceWith(wrapper);
    wrapper.append(input);
  }
  const marker = wrapper.querySelector<HTMLElement>(".flight-control-position__actual") ?? document.createElement("span");
  const ownsMarker = !marker.parentElement;
  if (ownsMarker) {
    marker.className = "flight-control-position__actual";
    marker.setAttribute("aria-hidden", "true");
    marker.hidden = true;
    wrapper.append(marker);
  }
  const oldTitle = input.getAttribute("title");
  const oldValueText = input.getAttribute("aria-valuetext");
  const set = (element: Element, name: string, value: string) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  return {
    update(command: number, actual?: number, detail?: string): void {
      const known = actual !== undefined && Number.isFinite(actual);
      const commandPercent = Math.round(command * 100);
      const actualPercent = known ? Math.round(actual * 100) : undefined;
      const visible = known && actualPercent !== commandPercent;
      if (marker.hidden === visible) marker.hidden = !visible;
      if (visible) {
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const fraction = Math.max(0, Math.min(1, (actual! - min) / (max - min || 1)));
        const position = String(fraction);
        if (wrapper.style.getPropertyValue("--control-actual") !== position) wrapper.style.setProperty("--control-actual", position);
      }
      const text = `${commandPercent}% commanded${known ? `; ${actualPercent}% actual` : ""}${detail ? `, ${detail}` : ""}`;
      set(input, "aria-valuetext", text);
      set(input, "title", `${text}. Round handle: command. White I-beam: actual position.`);
    },
    destroy(): void {
      if (ownsMarker) marker.remove();
      if (!existing && wrapper.parentElement) wrapper.replaceWith(input);
      for (const [name, value] of [["title", oldTitle], ["aria-valuetext", oldValueText]] as const) {
        if (value === null) input.removeAttribute(name);
        else set(input, name, value);
      }
    },
  };
}
