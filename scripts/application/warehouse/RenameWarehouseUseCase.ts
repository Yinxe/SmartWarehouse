/**
 * 重命名仓库用例。
 */

import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";

export interface RenameWarehouseInput {
  warehouseId: string;
  newName: string;
}

export interface RenameWarehouseResult {
  ok: boolean;
  error?: string;
}

export class RenameWarehouseUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly runtimeRegistry: RuntimeRegistryPort
  ) {}

  execute(input: RenameWarehouseInput): RenameWarehouseResult {
    const { warehouseId, newName } = input;

    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      return { ok: false, error: `仓库 ${warehouseId} 不存在` };
    }

    const updated = { ...warehouse, displayName: newName.trim() };
    this.repository.saveMetaOnly(updated as any);
    this.runtimeRegistry.markDirty(warehouseId);

    return { ok: true };
  }
}
