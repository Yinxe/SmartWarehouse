import { describe, expect, it } from "vitest";
import type { WarehouseId, ContainerId, DimensionId, BlockLocation } from "../../scripts/domain/shared/identifiers";

describe("Domain shared types", () => {
  it("can be used without any Minecraft runtime dependency", () => {
    const wid: WarehouseId = "main";
    const cid: ContainerId = "overworld|0|64|0";
    const did: DimensionId = "minecraft:overworld";
    const loc: BlockLocation = { x: 0, y: 64, z: 0 };

    expect(wid).toBe("main");
    expect(cid).toContain("overworld");
    expect(did).toBe("minecraft:overworld");
    expect(loc.x).toBe(0);
  });
});
