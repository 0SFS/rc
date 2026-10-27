import { useLayoutEffect, useRef, type InputHTMLAttributes, type RefObject } from "react";
import { mountNativeControlPosition, type ControlPositionOrientation } from "./controlPosition";
import { attachSliderPointer, type SliderPress } from "./sliderPointer";

/**
 * React owns the wrapper; the same marker painter also mounts desktop native
 * ranges. The finger drives it through `attachSliderPointer`, as Settings →
 * Sliders says (`press`); the keyboard moves the input itself. Either way the
 * new value goes to `onValue`.
 */
export function PhoneControlRange({ value, actual, orientation, inputRef, press, onValue, onPress, onRelease, ...props }:
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
    value: number;
    actual?: number;
    orientation: ControlPositionOrientation;
    inputRef?: RefObject<HTMLInputElement | null>;
    press: SliderPress;
    onValue(value: number): void;
    onPress?(): void;
    onRelease?(): void;
  }) {
  const ownRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownRef;
  const surface = useRef<HTMLSpanElement>(null);
  const position = useRef<ReturnType<typeof mountNativeControlPosition> | null>(null);
  // Read at each press and change, so the pointer handling outlives a re-render.
  const latest = useRef({ press, onValue, onPress, onRelease });
  useLayoutEffect(() => { latest.current = { press, onValue, onPress, onRelease }; });
  useLayoutEffect(() => {
    const mounted = mountNativeControlPosition(input.current!, orientation);
    position.current = mounted;
    return () => { mounted.destroy(); position.current = null; };
  }, [input, orientation]);
  useLayoutEffect(() => attachSliderPointer(surface.current!, input.current!, {
    orientation,
    press: () => latest.current.press,
    onValue: next => latest.current.onValue(next),
    onPress: () => latest.current.onPress?.(),
    onRelease: () => latest.current.onRelease?.(),
  }), [input, orientation]);
  useLayoutEffect(() => { position.current?.update(value, actual); }, [value, actual]);
  return <span ref={surface} className={`flight-control-position flight-control-position--${orientation}`}>
    <input {...props} ref={input} type="range" value={value} onChange={event => onValue(Number(event.target.value))} />
    <span className="flight-control-position__actual" aria-hidden="true" hidden />
  </span>;
}
