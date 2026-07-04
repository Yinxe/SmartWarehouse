/**
 * 仓库分拣用例。
 *
 * 协调分拣引擎的执行流程，通过端口接口与基础设施层解耦。
 * 业务规则委托给 domain/sorting/SortingPolicy 等领域服务。
 */

import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";
import type { SchedulerPort } from "../ports/SchedulerPort";

export interface SortWarehouseInput {
  warehouseId: string;
}

export interface SortWarehouseResult {
  ok: boolean;
  processed: boolean;
  error?: string;
}

export class SortWarehouseUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly runtimeRegistry: RuntimeRegistryPort,
    private readonly scheduler: SchedulerPort
  ) {}

  execute(input: SortWarehouseInput): SortWarehouseResult {
    const { warehouseId } = input;

    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      return { ok: false, processed: false, error: `仓库 ${warehouseId} 未找到` };
    }

    // 检查仓库是否启用
    if (!warehouse.settings?.enabled) {
      return { ok: true, processed: false };
    }

    // 触发调度（具体分拣逻辑在调度器循环中执行）
    this.scheduler.refresh(warehouseId, warehouse.settings.processingSpeed ?? 8);

    return { ok: true, processed: true };
  }
}
