import { describe, expect, it } from "vitest";
import { SchedulingUseCase } from "../../scripts/application/sorting/SchedulingUseCase";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("调度用例", () => {
  it("stopAll 调用调度器停止所有", () => {
    let stopAllCalled = false;
    const useCase = new SchedulingUseCase(
      { loadAll: () => [], exists: () => false, load: () => undefined, save: () => {}, saveMetaOnly: () => {}, patchContainers: () => {}, delete: () => {} },
      { start: () => {}, stop: () => {}, stopAll: () => { stopAllCalled = true; }, refresh: () => {} }
    );

    const result = useCase.execute({ action: "stopAll" });
    expect(result.ok).toBe(true);
    expect(stopAllCalled).toBe(true);
  });

  it("startAll 处理已启用的仓库", () => {
    const warehouses = [
      { id: "w1", settings: { enabled: true, processingSpeed: 8 } },
      { id: "w2", settings: { enabled: false, processingSpeed: 4 } },
    ];
    const mockRepo: WarehouseRepositoryPort = {
      loadAll: () => warehouses as any,
      exists: () => false,
      load: () => undefined,
      save: () => {},
      saveMetaOnly: () => {},
      patchContainers: () => {},
      delete: () => {},
    };
    let startedIds: string[] = [];
    const useCase = new SchedulingUseCase(
      mockRepo,
      { start: (id: string) => { startedIds.push(id); }, stop: () => {}, stopAll: () => {}, refresh: () => {} }
    );

    const result = useCase.execute({ action: "startAll" });
    expect(result.ok).toBe(true);
    expect(result.activeCount).toBe(1);
    expect(startedIds).toEqual(["w1"]);
  });
});
