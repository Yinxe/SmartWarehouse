import { describe, expect, it } from "vitest";
import { CreateWarehouseUseCase } from "../../scripts/application/warehouse/CreateWarehouseUseCase";
import { MoveInputStackUseCase } from "../../scripts/application/sorting/MoveInputStackUseCase";

describe("Application boundary", () => {
  const create = new CreateWarehouseUseCase();
  const move = new MoveInputStackUseCase();

  it("CreateWarehouseUseCase validates empty name", () => {
    const result = create.execute({
      name: "",
      dimensionId: "minecraft:overworld",
      pointA: { x: 0, y: 60, z: 0 },
      pointB: { x: 10, y: 70, z: 10 },
    });
    expect(result).toBe("仓库名称不能为空");
  });

  it("MoveInputStackUseCase returns processed=false for skeleton", () => {
    const result = move.execute({ warehouseId: "nonexistent" });
    expect(result.processed).toBe(false);
  });
});
