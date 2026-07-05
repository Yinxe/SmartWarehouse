import { describe, expect, it } from "vitest";
import { FakeDynamicPropertyStore } from "../helpers/FakeDynamicPropertyStore";
import { WarehouseRepository } from "../../scripts/persistence/WarehouseRepository";

function key(id: string, generation: number, shard: number): string {
  return `sw:warehouse:${id}:${generation}:containers:${shard}`;
}

describe("仓库仓储兼容性", () => {
  it("加载v1分片并补齐缺失设置在默认值", () => {
    const store = new FakeDynamicPropertyStore();
    store.setJson("sw:index", { version: 1, warehouses: ["legacy"] });
    store.setJson("sw:warehouse:legacy:meta", {
      version: 1,
      id: "legacy",
      displayName: "Legacy",
      dimensionId: "minecraft:overworld",
      area: { min: { x: 0, y: 60, z: 0 }, max: { x: 3, y: 70, z: 3 } },
      ownerId: "",
      settings: { enabled: true, defaultNewContainerRole: "normal", defaultNewContainerEnabled: true },
      containerShardCount: 1,
      containerCount: 1,
      containerShardGeneration: 7,
    });
    store.setJson(key("legacy", 7, 0), {
      version: 1,
      warehouseId: "legacy",
      shardIndex: 0,
      containers: {
        c1: {
          id: "c1",
          dimensionId: "minecraft:overworld",
          primaryLocation: { x: 1, y: 64, z: 1 },
          occupiedLocations: [{ x: 1, y: 64, z: 1 }],
          role: "normal",
          enabled: true,
          discoveredAt: 1,
          updatedAt: 1,
        },
      },
    });
    store.setJson(key("legacy", 6, 0), { version: 1, warehouseId: "legacy", shardIndex: 0, containers: {} });

    const repo = new WarehouseRepository(store as any);
    const loaded = repo.load("legacy");

    expect(loaded).toBeDefined();
    expect(loaded?.settings.capacityWarning).toBe(true);
    expect(Array.isArray(loaded?.settings.enabledFamilies)).toBe(true);
    expect(loaded?.containerShardGeneration).toBe(7);
    expect(Object.keys(loaded?.containers ?? {}).length).toBe(1);
  });
});
