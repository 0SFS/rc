import { useRef, useState } from "react";
import type { PhoneControllerClient } from "../phoneControllerClient";
import { PhoneControlRange } from "../PhoneControlRange";
import { PhoneStick } from "../PhoneStick";
import type { DroneCommand, DroneTelemetry } from "../protocol";
import type { SliderPress } from "../sliderPointer";

const LIMITS: Record<DroneCommand["droneId"], number> = { "dji-mini-2": 20, "dji-air-2s": 24 };

/**
 * Mode 2 quadcopter. Left stick climbs and yaws. Right stick translates.
 * Up on a stick is positive because PhoneStick's y is down-positive.
 */
export default function PhoneQuadcopter({ client, locked, sliders }: {
  client: PhoneControllerClient;
  locked: boolean;
  sliders: SliderPress;
}) {
  const status = client.getSnapshot().status?.drone;
  const telemetry = isTelemetry(status) ? status : null;
  const [droneId, setDroneId] = useState<DroneCommand["droneId"]>(telemetry?.droneId ?? "dji-mini-2");
  const [gimbal, setGimbal] = useState(0);
  const [capture, setCapture] = useState(false);
  const [sport, setSport] = useState(false);
  const sticks = useRef({ pitch: 0, roll: 0, yaw: 0, vertical: 0 });
  const max = LIMITS[droneId];
  const command = (shutter?: 1, overrides: Partial<DroneCommand> = {}) => {
    const id = overrides.droneId ?? droneId;
    const next: DroneCommand = {
      ...sticks.current, droneId: id,
      yawMode: "angularVelocity",
      gimbalPitchDeg: overrides.gimbalPitchDeg ?? Math.min(LIMITS[id], gimbal),
      sport: overrides.sport ?? sport,
      capture360: overrides.capture360 ?? capture,
      ...(shutter ? { shutter } : {}),
    };
    client.setDrone(next);
    client.updateControls({
      elevator: next.pitch, aileron: next.roll, rudder: next.yaw, throttle: next.vertical / 2 + 0.5,
    });
  };
  return <section className="phone-controls" aria-label="Quadcopter controls">
    <PhoneStick label="CLIMB / YAW" verticalLabels={{ up: "CLIMB", down: "DESCEND" }} disabled={locked} onChange={(x, y) => { sticks.current.yaw = x; sticks.current.vertical = -y; command(); }} />
    <PhoneStick label="PITCH / ROLL" verticalLabels={{ up: "FORWARD", down: "BACK" }} disabled={locked} onChange={(x, y) => { sticks.current.roll = x; sticks.current.pitch = -y; command(); }} />
    <label className="flight-hud__lever">
      <span>GIMBAL</span>
      <PhoneControlRange orientation="vertical" min={-90} max={max} step={1} value={Math.min(gimbal, max)} disabled={locked} press={sliders}
        aria-label="Gimbal pitch" onValue={value => { setGimbal(value); command(undefined, { gimbalPitchDeg: value }); }} />
    </label>
    <div className="phone-actions" aria-label="Quadcopter actions">
      <button type="button" disabled={locked} aria-pressed={droneId === "dji-mini-2"} onClick={() => { setDroneId("dji-mini-2"); setGimbal(value => Math.min(value, 20)); command(undefined, { droneId: "dji-mini-2", gimbalPitchDeg: Math.min(gimbal, 20) }); }}>Mini 2</button>
      <button type="button" disabled={locked} aria-pressed={droneId === "dji-air-2s"} onClick={() => { setDroneId("dji-air-2s"); command(undefined, { droneId: "dji-air-2s" }); }}>Air 2S</button>
      <button type="button" disabled={locked} onClick={() => command(1)}>Shutter</button>
      <button type="button" disabled={locked} aria-pressed={capture} onClick={() => { const next = !capture; setCapture(next); command(undefined, { capture360: next }); }}>360</button>
      <button type="button" disabled={locked} aria-pressed={sport} onClick={() => { const next = !sport; setSport(next); command(undefined, { sport: next }); }}>Sport</button>
      <span>{telemetry ? `${telemetry.nodeIndex}/${telemetry.nodeCount} ${telemetry.capturePhase}` : "0/0 idle"}</span>
    </div>
  </section>;
}

function isTelemetry(value: { available: true } | DroneTelemetry | undefined): value is DroneTelemetry {
  return Boolean(value && "droneId" in value);
}
