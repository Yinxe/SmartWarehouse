import { describe, expect, it } from "vitest";
import { DeleteWarehouseUseCase } from "../../scripts/application/warehouse/DeleteWarehouseUseCase";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("删除仓库用例", () => {
  it("仓库不存在时返回错误", () => {
    const mockRepo: WarehouseRepositoryPort = {
      load: () => undefined,
      loadAll: () => [],
      exists: () => false,
      save: () => {},
      saveMetaOnly: () => {},
      patchContainers: () => {},
      delete: () => {},
    };
    const useCase = new DeleteWarehouseUseCase(mockRepo, { delete: () => {}, markDirty: () => {}, resetCursor: () => {} }, { start: () => {}, stop: () => {}, stopAll: () => {}, refresh: () => {} });

    const result = useCase.execute({ warehouseId: "nonexistent" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不存在");
  });

  it("删除已存在的仓库", () => {
    let deleted = false;
    let stopped = false;
    const mockRepo: WarehouseRepositoryPort = {
      load: () => ({ id: "test", containers: {} }) as any,
      loadAll: () => [],
      exists: () => true,
      save: () => {},
      saveMetaOnly: () => {},
      patchContainers: () => {},
      delete: () => { deleted = true; },
    };
    const useCase = new DeleteWarehouseUseCase(
      mockRepo,
      { delete: () => {}, markDirty: () => {}, resetCursor: () => {} },
      { start: () => {}, stop: (id: string) => { stopped = true; }, stopAll: () => {}, refresh: () => {} }
    );

    const result = useCase.execute({ warehouseId: "test" });
    expect(result.ok).toBe(true);
    expect(deleted).toBe(true);
    expect(stopped).toBe(true);
  });
});
