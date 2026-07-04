import { describe, expect, it } from "vitest";

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

describe("端口契约辅助函数", () => {
  it("规范化Minecraft API异常", () => {
    const result = safe(() => {
      throw new Error("unloaded chunk");
    });

    expect(result).toBeUndefined();
  });

  it("规范化断线玩家通知失败", () => {
    const messageResult = safe(() => {
      throw new Error("player disconnected");
    });

    expect(messageResult).toBeUndefined();
  });
});
