export function loadQuadcopter(): Promise<typeof import("./PhoneQuadcopter")> {
  return import("./PhoneQuadcopter");
}
