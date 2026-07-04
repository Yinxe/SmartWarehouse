/**
 * 分拣调度用例。
 *
 * 管理仓库分拣的生命周期：启动、停止、刷新。
 * 具体的调度循环由基础设施层的 Minecraft tick 系统实现。
 */

import type { SchedulerPort } from "../ports/SchedulerPort";
import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";

export interface SchedulingUseCaseInput {
  action: "startAll" | "stopAll" | "refresh" | "stop";
  warehouseIds?: string[];
}

export interface SchedulingUseCaseResult {
  ok: boolean;
  activeCount?: number;
  error?: string;
}

export class SchedulingUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly scheduler: SchedulerPort
  ) {}

  execute(input: SchedulingUseCaseInput): SchedulingUseCaseResult {
    switch (input.action) {
      case "startAll": {
        const warehouses = this.repository.loadAll();
        for (const w of warehouses) {
          if (w.settings?.enabled) {
            this.scheduler.start(
              w.id,
              w.settings.processingSpeed ?? 8,
              () => {/* 由基础设施层实现回调 */ }
            );
          }
        }
        return { ok: true, activeCount: warehouses.filter((w) => w.settings?.enabled).length };
      }

      case "stopAll":
        this.scheduler.stopAll();
        return { ok: true };

      case "stop":
        if (input.warehouseIds) {
          for (const id of input.warehouseIds) {
            this.scheduler.stop(id);
          }
        }
        return { ok: true };

      case "refresh":
        if (input.warehouseIds) {
          for (const id of input.warehouseIds) {
            const w = this.repository.load(id);
            if (w) {
              this.scheduler.refresh(id, w.settings.processingSpeed ?? 8);
            }
          }
        }
        return { ok: true };

      default:
        return { ok: false, error: "未知操作" };
    }
  }
}
