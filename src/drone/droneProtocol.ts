import type { DroneCommand } from "../protocol";

/** Builders the lazy quad UI and the flight chunk share. The wire types stay in the protocol. */
export function droneCommand(command: DroneCommand): DroneCommand {
  return command;
}
