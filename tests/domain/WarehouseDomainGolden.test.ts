import { describe, expect, it } from "vitest";
import type { WarehouseData } from "../../scripts/types";
import { buildWarehouseRuntimeModel } from "../../scripts/lib/WarehouseRuntimeModel";

function baseWarehouse(): WarehouseData {
  return {
    version: 1,
    id: "main",
    displayName: "main",
    dimensionId: "minecraft:overworld",
    area: { min: { x: 0, y: 60, z: 0 }, max: { x: 10, y: 70, z: 10 } },
    ownerId: "",
    settings: {
      defaultNewContainerRole: "normal",
      defaultNewContainerEnabled: true,
      autoCreateCategories: true,
      enabled: true,
      processingSpeed: 8,
      debug: false,
      showBoundary: false,
      autoSortThreshold: 0,
      enabledFamilies: [],
      capacityWarning: true,
    },
    containerShardCount: 1,
    containerCount: 3,
    containerShardGeneration: 1,
    containers: {
      input1: {
        id: "input1",
        dimensionId: "minecraft:overworld",
        primaryLocation: { x: 1, y: 64, z: 1 },
        occupiedLocations: [{ x: 1, y: 64, z: 1 }],
        role: "input",
        enabled: true,
        discoveredAt: 1,
        updatedAt: 1,
      },
      disabled1: {
        id: "disabled1",
        dimensionId: "minecraft:overworld",
        primaryLocation: { x: 2, y: 64, z: 1 },
        occupiedLocations: [{ x: 2, y: 64, z: 1 }],
        role: "normal",
        enabled: false,
        discoveredAt: 1,
        updatedAt: 1,
      },
      normalDouble: {
        id: "normalDouble",
        dimensionId: "minecraft:overworld",
        primaryLocation: { x: 3, y: 64, z: 1 },
        occupiedLocations: [{ x: 3, y: 64, z: 1 }, { x: 4, y: 64, z: 1 }],
        role: "normal",
        enabled: true,
        discoveredAt: 1,
        updatedAt: 1,
      },
    },
  };
}

describe("仓库运行时模型黄金行为", () => {
  it("索引已启用/已禁用/双箱占位", () => {
    const warehouse = baseWarehouse();
    const model = buildWarehouseRuntimeModel(warehouse);

    expect(model.inputContainerIds.length).toBe(1);
    expect(model.normalContainerIds.length).toBe(1);
    expect(model.disabledContainerIds.length).toBe(1);
    expect(model.occupiedLocationIndex.size).toBe(4);
  });

  it("复制occupiedLocations而非共享持久化数组", () => {
    const warehouse = baseWarehouse();
    const model = buildWarehouseRuntimeModel(warehouse);
    const storedBefore = warehouse.containers.normalDouble.occupiedLocations.length;
    const runtimeContainer = model.containersById.get("normalDouble");

    expect(runtimeContainer).toBeDefined();
    runtimeContainer?.occupiedLocations.pop();
    expect(warehouse.containers.normalDouble.occupiedLocations.length).toBe(storedBefore);
  });
});
