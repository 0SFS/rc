import { useLayoutEffect, useRef, type InputHTMLAttributes, type RefObject } from "react";
import { mountNativeControlPosition, type ControlPositionOrientation } from "./controlPosition";

/** React owns the wrapper; the same marker painter also mounts desktop native ranges. */
export function PhoneControlRange({ value, actual, orientation, inputRef, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: number;
  actual?: number;
  orientation: ControlPositionOrientation;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownRef;
  const position = useRef<ReturnType<typeof mountNativeControlPosition> | null>(null);
  useLayoutEffect(() => {
    const mounted = mountNativeControlPosition(input.current!, orientation);
    position.current = mounted;
    return () => { mounted.destroy(); position.current = null; };
  }, [input, orientation]);
  useLayoutEffect(() => { position.current?.update(value, actual); }, [value, actual]);
  return <span className={`flight-control-position flight-control-position--${orientation}`}>
    <input {...props} ref={input} type="range" value={value} />
    <span className="flight-control-position__actual" aria-hidden="true" hidden />
  </span>;
}
