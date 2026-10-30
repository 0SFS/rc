/** Layout belongs to this device, independently of the paired computer. */
export interface PhoneControlLayout {
  planeAttitudeSide: "left" | "right";
  droneAttitudeSide: "left" | "right";
}

export const PHONE_CONTROL_LAYOUT_KEY = "osfs.phone.controlLayout";
export const DEFAULT_PHONE_CONTROL_LAYOUT: Readonly<PhoneControlLayout> = {
  planeAttitudeSide: "left", droneAttitudeSide: "right",
};

export function readPhoneControlLayout(storage: Pick<Storage, "getItem"> | null): PhoneControlLayout {
  try {
    const saved = JSON.parse(storage?.getItem(PHONE_CONTROL_LAYOUT_KEY) ?? "null") as Partial<PhoneControlLayout> | null;
    return {
      planeAttitudeSide: saved?.planeAttitudeSide === "right" ? "right" : "left",
      droneAttitudeSide: saved?.droneAttitudeSide === "left" ? "left" : "right",
    };
  } catch { return { ...DEFAULT_PHONE_CONTROL_LAYOUT }; }
}

export function savePhoneControlLayout(storage: Pick<Storage, "setItem"> | null, layout: PhoneControlLayout): void {
  try { storage?.setItem(PHONE_CONTROL_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* This visit only. */ }
}
