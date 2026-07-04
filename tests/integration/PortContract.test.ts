import { describe, expect, it } from "vitest";

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

describe("Port contract helpers", () => {
  it("normalizes thrown Minecraft API failures", () => {
    const result = safe(() => {
      throw new Error("unloaded chunk");
    });

    expect(result).toBeUndefined();
  });

  it("normalizes disconnected-player notification failures", () => {
    const messageResult = safe(() => {
      throw new Error("player disconnected");
    });

    expect(messageResult).toBeUndefined();
  });
});
