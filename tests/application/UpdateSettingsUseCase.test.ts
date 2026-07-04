import { describe, expect, it } from "vitest";
import { UpdateSettingsUseCase } from "../../scripts/application/warehouse/UpdateSettingsUseCase";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("更新设置用例", () => {
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
    const useCase = new UpdateSettingsUseCase(mockRepo, { delete: () => {}, markDirty: () => {}, resetCursor: () => {} }, { start: () => {}, stop: () => {}, stopAll: () => {}, refresh: () => {} });

    const result = useCase.execute({ warehouseId: "nonexistent", settings: { enabled: false } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不存在");
  });

  it("更新已有仓库的设置", () => {
    let saved = false;
    const mockRepo: WarehouseRepositoryPort = {
      load: () => ({ id: "test", settings: { enabled: true, processingSpeed: 8 }, containers: {} }) as any,
      loadAll: () => [],
      exists: () => true,
      save: () => {},
      saveMetaOnly: () => { saved = true; },
      patchContainers: () => {},
      delete: () => {},
    };
    const useCase = new UpdateSettingsUseCase(mockRepo, { delete: () => {}, markDirty: () => {}, resetCursor: () => {} }, { start: () => {}, stop: () => {}, stopAll: () => {}, refresh: () => {} });

    const result = useCase.execute({ warehouseId: "test", settings: { enabled: false } });
    expect(result.ok).toBe(true);
    expect(saved).toBe(true);
  });
});
