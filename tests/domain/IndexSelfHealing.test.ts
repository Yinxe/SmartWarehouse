import { describe, expect, it } from "vitest";
import { validateIndexCandidates, cleanStaleIndexEntries, mergeIntoIndex } from "../../scripts/sorting/IndexSelfHealing";

function makeContainerMap(entries: Record<string, { role: string; enabled: boolean; types: string[] }>) {
  const result: Record<string, { role: string; enabled: boolean; containsType: (typeId: string) => boolean }> = {};
  for (const [id, meta] of Object.entries(entries)) {
    result[id] = {
      role: meta.role,
      enabled: meta.enabled,
      containsType: (typeId: string) => meta.types.includes(typeId),
    };
  }
  return result;
}

describe("校验索引候选", () => {
  it("校验仍包含目标类型的容器", () => {
    const map = makeContainerMap({
      c1: { role: "normal", enabled: true, types: ["minecraft:stone"] },
      c2: { role: "normal", enabled: true, types: ["minecraft:dirt"] },
    });
    const result = validateIndexCandidates(["c1", "c2"], map, "minecraft:stone");
    expect(result.valid).toEqual(["c1"]);
    expect(result.stale).toEqual(["c2"]);
  });

  it("标记不含目标类型的容器为脏", () => {
    const map = makeContainerMap({ c1: { role: "normal", enabled: true, types: [] } });
    const result = validateIndexCandidates(["c1", "c2"], map, "minecraft:stone");
    expect(result.valid).toEqual([]);
    expect(result.stale).toEqual(["c1", "c2"]);
    expect(result.valid).toHaveLength(0);
  });

  it("标记已禁用的容器为脏", () => {
    const map = makeContainerMap({
      c1: { role: "normal", enabled: false, types: ["minecraft:stone"] },
    });
    const result = validateIndexCandidates(["c1"], map, "minecraft:stone");
    expect(result.stale).toEqual(["c1"]);
    expect(result.valid).toHaveLength(0);
  });
});

describe("清除脏索引条目", () => {
  it("移除脏条目并保留有效条目", () => {
    const index = new Map([["minecraft:stone", ["c1", "c2", "c3"]]]);
    cleanStaleIndexEntries(index, "minecraft:stone", new Set(["c2"]));
    expect(index.get("minecraft:stone")).toEqual(["c1", "c3"]);
  });

  it("全部脏时删除整个键", () => {
    const index = new Map([["minecraft:stone", ["c1", "c2"]]]);
    cleanStaleIndexEntries(index, "minecraft:stone", new Set(["c1", "c2"]));
    expect(index.has("minecraft:stone")).toBe(false);
  });
});

describe("合并到索引", () => {
  it("添加新容器ID到现有索引", () => {
    const index = new Map([["minecraft:stone", ["c1"]]]);
    mergeIntoIndex(index, "minecraft:stone", ["c2", "c3"]);
    expect(index.get("minecraft:stone")).toEqual(["c1", "c2", "c3"]);
  });

  it("去重容器ID", () => {
    const index = new Map([["minecraft:stone", ["c1", "c2"]]]);
    mergeIntoIndex(index, "minecraft:stone", ["c2", "c3"]);
    expect(index.get("minecraft:stone")).toEqual(["c1", "c2", "c3"]);
  });

  it("无索引时创建新条目", () => {
    const index = new Map();
    mergeIntoIndex(index, "minecraft:stone", ["c1"]);
    expect(index.get("minecraft:stone")).toEqual(["c1"]);
  });
});
