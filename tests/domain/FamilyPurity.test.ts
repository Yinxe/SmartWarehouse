import { describe, expect, it } from "vitest";
import { calculateFamilyPurity, sortByFamilyPurity } from "../../scripts/lib/FamilyPurity";

const WOOL_SET = new Set([
  "minecraft:white_wool", "minecraft:orange_wool", "minecraft:magenta_wool",
  "minecraft:light_blue_wool", "minecraft:yellow_wool", "minecraft:lime_wool",
  "minecraft:pink_wool", "minecraft:gray_wool", "minecraft:light_gray_wool",
  "minecraft:cyan_wool", "minecraft:purple_wool", "minecraft:blue_wool",
  "minecraft:brown_wool", "minecraft:green_wool", "minecraft:red_wool",
  "minecraft:black_wool",
]);

describe("家族纯度计算", () => {
  it("纯羊毛容器返回1.0", () => {
    const result = calculateFamilyPurity(
      { typeIds: new Set(["minecraft:white_wool", "minecraft:black_wool"]) },
      WOOL_SET
    );
    expect(result).toBe(1.0);
  });

  it("半羊毛容器返回0.5", () => {
    const result = calculateFamilyPurity(
      { typeIds: new Set(["minecraft:white_wool", "minecraft:stone"]) },
      WOOL_SET
    );
    expect(result).toBe(0.5);
  });

  it("无家族物品的容器返回0", () => {
    const result = calculateFamilyPurity(
      { typeIds: new Set(["minecraft:stone", "minecraft:dirt"]) },
      WOOL_SET
    );
    expect(result).toBe(0);
  });

  it("空容器返回0", () => {
    const result = calculateFamilyPurity({ typeIds: new Set() }, WOOL_SET);
    expect(result).toBe(0);
  });
});

describe("按家族纯度排序", () => {
  it("按纯度降序排列容器", () => {
    const getContent = (id: string) => {
      if (id === "pure") return { typeIds: new Set(["minecraft:white_wool"]) };
      if (id === "mixed") return { typeIds: new Set(["minecraft:white_wool", "minecraft:stone"]) };
      if (id === "none") return { typeIds: new Set(["minecraft:stone"]) };
      return undefined;
    };
    const result = sortByFamilyPurity(["mixed", "pure", "none"], getContent, WOOL_SET);
    expect(result[0]).toBe("pure");
    expect(result[1]).toBe("mixed");
    expect(result[2]).toBe("none");
  });

  it("同等纯度时保持原始顺序", () => {
    const getContent = (id: string) => ({ typeIds: new Set(["minecraft:white_wool"]) });
    const result = sortByFamilyPurity(["a", "b", "c"], getContent, WOOL_SET);
    expect(result).toEqual(["a", "b", "c"]);
  });
});
