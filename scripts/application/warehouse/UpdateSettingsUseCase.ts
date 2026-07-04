/**
 * 更新仓库设置用例。
 *
 * 部分更新仓库的设置字段。
 */

import type { WarehouseRepositoryPort, WarehouseMetaDto } from "../ports/WarehouseRepositoryPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";
import type { SchedulerPort } from "../ports/SchedulerPort";

export interface UpdateSettingsInput {
  warehouseId: string;
  settings: Record<string, unknown>;
}

export interface UpdateSettingsResult {
  ok: boolean;
  error?: string;
}

export class UpdateSettingsUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly runtimeRegistry: RuntimeRegistryPort,
    private readonly scheduler: SchedulerPort
  ) {}

  execute(input: UpdateSettingsInput): UpdateSettingsResult {
    const { warehouseId, settings } = input;

    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      return { ok: false, error: `仓库 ${warehouseId} 不存在` };
    }

    const updated = {
      ...warehouse,
      settings: { ...warehouse.settings, ...settings },
    };

    this.repository.saveMetaOnly(updated as WarehouseMetaDto);
    this.runtimeRegistry.markDirty(warehouseId);
    const speed = typeof updated.settings.processingSpeed === "number"
      ? updated.settings.processingSpeed : 8;
    this.scheduler.refresh(warehouseId, speed);

    return { ok: true };
  }
}
