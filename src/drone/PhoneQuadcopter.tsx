import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PhoneControllerClient } from "../phoneControllerClient";
import { PhoneControlRange } from "../PhoneControlRange";
import { PhoneCameraPad, PhoneStick, type PhoneCameraPadProps, type PhoneStickInstrument } from "../PhoneStick";
import type { DroneCommand, DroneTelemetry, DroneMotorStatus } from "../protocol";
import type { SliderPress } from "../sliderPointer";

import "../styles/droneFlightLayout.css";

import { INSTRUMENT_STICK_HALF_SHARE } from "@0sfs/controls/centeredStick";
import { createQuadEngineMonitor, type QuadEngineMonitor } from "@0sfs/engines/quadEngineMonitor";

const LIMITS: Record<DroneCommand["droneId"], number> = { "dji-mini2": 20, "dji-air2s": 24 };

/**
 * Mode 2 quadcopter. Left stick climbs and yaws. Right stick translates.
 * Up on a stick is positive because PhoneStick's y is down-positive.
 */
export default function PhoneQuadcopter({ client, locked, sliders, instrument, attitudeSide, camera }: {
  client: PhoneControllerClient;
  camera: Omit<PhoneCameraPadProps, "disabled" | "background">;
  locked: boolean;
  sliders: SliderPress;
  instrument?: PhoneStickInstrument;
  attitudeSide: "left" | "right";
}) {
  const aircraft = client.getSnapshot().status;
  const status = aircraft?.drone;
  const telemetry = isTelemetry(status) ? status : null;
  const [droneId, setDroneId] = useState<DroneCommand["droneId"]>(telemetry?.droneId ?? "dji-mini2");
  const selectedId = useRef(droneId);
  const initialRemoteId = useRef(telemetry?.droneId);
  const [gimbal, setGimbal] = useState(0);
  const [capture, setCapture] = useState(false);
  const [sport, setSport] = useState(false);
  const sticks = useRef({ pitch: 0, roll: 0, yaw: 0, vertical: 0 });
  const max = LIMITS[droneId];
  const [airframeRevision, setAirframeRevision] = useState(0);
  const command = (shutter?: 1, overrides: Partial<DroneCommand> = {}) => {
    const remote = client.getSnapshot().status?.drone;
    const changedRemoteId = isTelemetry(remote) && remote.droneId !== initialRemoteId.current ? remote.droneId : undefined;
    const id = overrides.droneId ?? changedRemoteId ?? selectedId.current;
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
  const selectDrone = (id: DroneCommand["droneId"]) => {
    sticks.current = { pitch: 0, roll: 0, yaw: 0, vertical: 0 };
    selectedId.current = id;
    setDroneId(id);
    setAirframeRevision(value => value + 1);
    setGimbal(value => Math.min(value, LIMITS[id]));
    command(undefined, { droneId: id, gimbalPitchDeg: Math.min(gimbal, LIMITS[id]) });
  };
  return <section className="phone-drone-controls" aria-label="Quadcopter controls">
    <PhoneCameraPad {...camera} disabled={locked} background />
    <div className="phone-drone__sticks drone-flight-layout" data-attitude-side={attitudeSide}>
      <PhoneStick key={`motors-${attitudeSide}-${airframeRevision}`} className="phone-stick--motors drone-flight-layout__motors" square halfShare={INSTRUMENT_STICK_HALF_SHARE} label="CLIMB / YAW" verticalLabels={{ up: "CLIMB", down: "DESCEND" }} disabled={locked} onChange={(x, y) => { sticks.current.yaw = x; sticks.current.vertical = y === 0 ? 0 : -y; command(); }}>
        <PhoneQuadMotors reading={aircraft?.droneMotors} paused={aircraft?.paused ?? true} />
      </PhoneStick>
      <PhoneStick key={`attitude-${attitudeSide}-${airframeRevision}`} className="phone-stick--drone-attitude drone-flight-layout__attitude" square halfShare={INSTRUMENT_STICK_HALF_SHARE} label="PITCH / ROLL" instrument={instrument} verticalLabels={{ up: "FORWARD", down: "BACK" }} disabled={locked} onChange={(x, y) => { sticks.current.roll = x; sticks.current.pitch = y === 0 ? 0 : -y; command(); }} />
    </div>
    <div className="phone-drone__extras">
    {(["flaps", "pitchTrim", "rollTrim"] as const).map(axis => aircraft?.controlCapabilities?.[axis] === true && <label className="phone-drone__gimbal" key={axis}>
      <span>{axis === "flaps" ? "FLAPS" : axis === "pitchTrim" ? "PITCH TRIM" : "ROLL TRIM"}</span>
      <PhoneControlRange orientation="horizontal" min={axis === "flaps" ? 0 : -1} max={1} step={.01}
        value={client.getSnapshot().controls[axis]} disabled={locked} press={sliders}
        aria-label={axis === "flaps" ? "Flaps" : axis === "pitchTrim" ? "Pitch trim" : "Roll trim"}
        onValue={value => client.updateControls({ [axis]: value })} />
    </label>)}
    <label className="phone-drone__gimbal">
      <span>GIMBAL</span>
      <PhoneControlRange orientation="horizontal" min={-90} max={max} step={1} value={Math.min(gimbal, max)} disabled={locked} press={sliders}
        aria-label="Gimbal pitch" onValue={value => { setGimbal(value); command(undefined, { gimbalPitchDeg: value }); }} />
    </label>
    <div className="phone-drone__actions" aria-label="Quadcopter actions">
      <button type="button" disabled={locked} aria-pressed={droneId === "dji-mini2"} onClick={() => selectDrone("dji-mini2")}>Mini 2</button>
      <button type="button" disabled={locked} aria-pressed={droneId === "dji-air2s"} onClick={() => selectDrone("dji-air2s")}>Air 2S</button>
      <button type="button" disabled={locked} onClick={() => command(1)}>Shutter</button>
      <button type="button" disabled={locked} aria-pressed={capture} onClick={() => { const next = !capture; setCapture(next); command(undefined, { capture360: next }); }}>360</button>
      <button type="button" disabled={locked} aria-pressed={sport} onClick={() => { const next = !sport; setSport(next); command(undefined, { sport: next }); }}>Sport</button>
      <span>{telemetry ? `${telemetry.nodeIndex}/${telemetry.nodeCount} ${telemetry.capturePhase}` : "0/0 idle"}</span>
    </div>
    </div>
  </section>;
}

function isTelemetry(value: { available: true } | DroneTelemetry | undefined): value is DroneTelemetry {
  return Boolean(value && "droneId" in value);
}

/** The same four-motor face as the main HUD, fed by the host's readings and budgets. */
function PhoneQuadMotors({ reading, paused }: { reading?: DroneMotorStatus; paused: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const monitor = useRef<QuadEngineMonitor | null>(null);
  const latest = useRef(reading);
  useLayoutEffect(() => { latest.current = reading; }, [reading]);
  useEffect(() => {
    const mounted = createQuadEngineMonitor(host.current!, {
      summaryMode: "passive",
      allowOwnDevice: true,
      getOrbSettings: () => latest.current?.orbs ?? { renderer: "off", fps: 0, turnsPerSecond: 0, pixelRatio: 1 },
    });
    monitor.current = mounted;
    return () => { mounted.destroy(); monitor.current = null; };
  }, []);
  useEffect(() => { monitor.current?.update(reading ?? null, paused); }, [reading, paused]);
  return <span className="phone-stick__motors" ref={host} />;
}
