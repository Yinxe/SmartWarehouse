import { describe, expect, it } from "vitest";
import { SetContainerRoleUseCase } from "../../scripts/application/warehouse/SetContainerRoleUseCase";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("设置容器角色用例", () => {
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
    const useCase = new SetContainerRoleUseCase(mockRepo, { delete: () => {}, markDirty: () => {}, resetCursor: () => {} });

    const result = useCase.execute({ warehouseId: "nonexistent", containerId: "c1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不存在");
  });

  it("容器不存在时返回错误", () => {
    const mockRepo: WarehouseRepositoryPort = {
      load: () => ({ id: "test", containers: {} }) as any,
      loadAll: () => [],
      exists: () => true,
      save: () => {},
      saveMetaOnly: () => {},
      patchContainers: () => {},
      delete: () => {},
    };
    const useCase = new SetContainerRoleUseCase(mockRepo, { delete: () => {}, markDirty: () => {}, resetCursor: () => {} });

    const result = useCase.execute({ warehouseId: "test", containerId: "c1", role: "normal" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不属于");
  });

  it("设置已有容器的角色", () => {
    let savedData: any = null;
    const mockRepo: WarehouseRepositoryPort = {
      load: () => ({ id: "test", containers: { c1: { id: "c1", role: "misc", enabled: true, updatedAt: 0 } } }) as any,
      loadAll: () => [],
      exists: () => true,
      save: (data: any) => { savedData = data; },
      saveMetaOnly: () => {},
      patchContainers: () => {},
      delete: () => {},
    };
    const useCase = new SetContainerRoleUseCase(mockRepo, { delete: () => {}, markDirty: () => {}, resetCursor: () => {} });

    const result = useCase.execute({ warehouseId: "test", containerId: "c1", role: "normal" });
    expect(result.ok).toBe(true);
    expect(savedData.containers.c1.role).toBe("normal");
  });
});
