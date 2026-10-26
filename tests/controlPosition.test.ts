// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountNativeControlPosition } from "../src/controlPosition";

afterEach(() => document.body.replaceChildren());

describe("physical control positions", () => {
  it("moves only the physical marker when telemetry changes and keeps the command native", () => {
    document.body.innerHTML = '<label>Flaps<input type="range" min="0" max="1" step="0.01" value="0.8"></label>';
    const input = document.querySelector("input")!;
    const changed = vi.fn();
    input.addEventListener("input", changed);
    const position = mountNativeControlPosition(input, "vertical");
    position.update(.8, .2, "automatic flaps");
    const marker = input.parentElement!.querySelector<HTMLElement>(".flight-control-position__actual")!;
    expect(input.value).toBe("0.8");
    expect(marker.hidden).toBe(false);
    expect(input.parentElement!.style.getPropertyValue("--control-actual")).toBe("0.2");
    expect(input.getAttribute("aria-valuetext")).toBe("80% commanded; 20% actual, automatic flaps");
    position.update(.8, .6, "automatic flaps");
    expect(input.value).toBe("0.8");
    expect(input.parentElement!.style.getPropertyValue("--control-actual")).toBe("0.6");
    expect(changed).not.toHaveBeenCalled();
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    position.update(.8, .6, "automatic flaps");
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
    position.destroy();
    expect(input.parentElement!.tagName).toBe("LABEL");
    expect(input.hasAttribute("aria-valuetext")).toBe(false);
  });

  it("maps signed axes and hides unknown or equal positions without inventing telemetry", () => {
    document.body.innerHTML = '<label>Yaw<input type="range" min="-1" max="1" step="0.01" value="0.5"></label>';
    const input = document.querySelector("input")!;
    const position = mountNativeControlPosition(input, "horizontal");
    const wrapper = input.parentElement!;
    const marker = wrapper.querySelector<HTMLElement>(".flight-control-position__actual")!;
    position.update(.5, -.5);
    expect(wrapper.style.getPropertyValue("--control-actual")).toBe("0.25");
    position.update(.5, .504);
    expect(marker.hidden).toBe(true);
    position.update(.5, Number.NaN);
    expect(marker.hidden).toBe(true);
    expect(input.getAttribute("aria-valuetext")).toBe("50% commanded");
    position.destroy();
  });
});
