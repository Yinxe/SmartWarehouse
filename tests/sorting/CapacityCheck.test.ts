import { describe, expect, it } from "vitest";
import { checkGroupCapacity, formatCapacityWarning, CAPACITY_WARNING_THRESHOLD } from "../../scripts/sorting/algorithm/CapacityCheck";

describe("组级容量检查", () => {
  it("低使用率时不触发预警", () => {
    const result = checkGroupCapacity(
      { c1: { totalSlots: 27, usedSlots: 5 } },
      0.8
    );
    expect(result.isWarning).toBe(false);
    expect(result.usageRatio).toBeCloseTo(0.185);
  });

  it("高使用率时触发预警", () => {
    const result = checkGroupCapacity(
      { c1: { totalSlots: 27, usedSlots: 25 } },
      0.8
    );
    expect(result.isWarning).toBe(true);
    expect(result.usageRatio).toBeCloseTo(0.926);
  });

  it("聚合多个容器", () => {
    const result = checkGroupCapacity(
      {
        c1: { totalSlots: 27, usedSlots: 25 },
        c2: { totalSlots: 27, usedSlots: 20 },
      },
      0.8
    );
    expect(result.totalSlots).toBe(54);
    expect(result.totalUsed).toBe(45);
    expect(result.usageRatio).toBeCloseTo(0.833);
    expect(result.isWarning).toBe(true);
  });

  it("空输入处理", () => {
    const result = checkGroupCapacity({}, 0.8);
    expect(result.totalSlots).toBe(0);
    expect(result.usageRatio).toBe(0);
    expect(result.isWarning).toBe(false);
  });
});

describe("容量预警格式化", () => {
  it("格式化预警消息", () => {
    const result = checkGroupCapacity(
      { c1: { totalSlots: 27, usedSlots: 25 } },
      CAPACITY_WARNING_THRESHOLD
    );
    const msg = formatCapacityWarning(result, "普通", "minecraft:stone");
    expect(msg).toContain("普通");
    expect(msg).toContain("minecraft:stone");
    expect(msg).toContain("93%");
  });
});
