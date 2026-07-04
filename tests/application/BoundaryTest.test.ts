import { describe, expect, it } from "vitest";
import { CreateWarehouseUseCase } from "../../scripts/application/warehouse/CreateWarehouseUseCase";
import { MoveInputStackUseCase } from "../../scripts/application/sorting/MoveInputStackUseCase";

describe("应用层边界测试", () => {
  const create = new CreateWarehouseUseCase();
  const move = new MoveInputStackUseCase();

  it("创建仓库用例校验空名称", () => {
    const result = create.execute({
      name: "",
      dimensionId: "minecraft:overworld",
      pointA: { x: 0, y: 60, z: 0 },
      pointB: { x: 10, y: 70, z: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("仓库名称不能为空");
  });

  it("输入槽分拣用例骨架返回未处理", () => {
    const result = move.execute({ warehouseId: "nonexistent" });
    expect(result.processed).toBe(false);
  });
});
