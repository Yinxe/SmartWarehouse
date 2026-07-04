/**
 * 删除仓库用例。
 *
 * 从持久化存储移除仓库数据，清理运行时缓存，
 * 通知调度器停止该仓库的调度。
 */

import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";
import type { SchedulerPort } from "../ports/SchedulerPort";

export interface DeleteWarehouseInput {
  warehouseId: string;
}

export interface DeleteWarehouseResult {
  ok: boolean;
  error?: string;
}

export class DeleteWarehouseUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly runtimeRegistry: RuntimeRegistryPort,
    private readonly scheduler: SchedulerPort
  ) {}

  execute(input: DeleteWarehouseInput): DeleteWarehouseResult {
    const { warehouseId } = input;

    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      return { ok: false, error: `仓库 ${warehouseId} 不存在` };
    }

    this.repository.delete(warehouseId);
    this.runtimeRegistry.delete(warehouseId);
    this.scheduler.stop(warehouseId);

    return { ok: true };
  }
}
