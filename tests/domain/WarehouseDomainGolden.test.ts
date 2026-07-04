import { describe, expect, it } from "vitest";
import type { WarehouseData } from "../../scripts/types";
import { buildWarehouseRuntimeModel } from "../../scripts/runtime/WarehouseRuntimeModel";

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

describe("Warehouse runtime model golden behavior", () => {
  it("indexes enabled, disabled, and double chest occupied locations like the current code", () => {
    const warehouse = baseWarehouse();
    const model = buildWarehouseRuntimeModel(warehouse);

    expect(model.inputContainerIds.length).toBe(1);
    expect(model.normalContainerIds.length).toBe(1);
    expect(model.disabledContainerIds.length).toBe(1);
    expect(model.occupiedLocationIndex.size).toBe(4);
  });

  it("copies occupiedLocations instead of sharing persistent arrays", () => {
    const warehouse = baseWarehouse();
    const model = buildWarehouseRuntimeModel(warehouse);
    const storedBefore = warehouse.containers.normalDouble.occupiedLocations.length;
    const runtimeContainer = model.containersById.get("normalDouble");

    expect(runtimeContainer).toBeDefined();
    runtimeContainer?.occupiedLocations.pop();
    expect(warehouse.containers.normalDouble.occupiedLocations.length).toBe(storedBefore);
  });
});
