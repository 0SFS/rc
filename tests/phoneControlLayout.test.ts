import { describe, expect, it } from "vitest";
import { readPhoneControlLayout, savePhoneControlLayout, PHONE_CONTROL_LAYOUT_KEY } from "../src/phoneControlLayout";

describe("phone control sides", () => {
  it("keeps separate plane and drone preferences on this device", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readPhoneControlLayout(storage)).toEqual({ planeAttitudeSide: "left", droneAttitudeSide: "right" });
    savePhoneControlLayout(storage, { planeAttitudeSide: "right", droneAttitudeSide: "left" });
    expect(readPhoneControlLayout(storage)).toEqual({ planeAttitudeSide: "right", droneAttitudeSide: "left" });
    values.set(PHONE_CONTROL_LAYOUT_KEY, "broken");
    expect(readPhoneControlLayout(storage)).toEqual({ planeAttitudeSide: "left", droneAttitudeSide: "right" });
    expect(readPhoneControlLayout(null)).toEqual({ planeAttitudeSide: "left", droneAttitudeSide: "right" });
  });
});
