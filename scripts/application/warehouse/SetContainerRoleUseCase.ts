/**
 * 设置容器角色用例。
 *
 * 更新指定容器的角色和启用状态。
 */

import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";

export interface SetContainerRoleInput {
  warehouseId: string;
  containerId: string;
  role?: string | null;
  enabled?: boolean | null;
}

export interface SetContainerRoleResult {
  ok: boolean;
  error?: string;
}

export class SetContainerRoleUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly runtimeRegistry: RuntimeRegistryPort
  ) {}

  execute(input: SetContainerRoleInput): SetContainerRoleResult {
    const { warehouseId, containerId, role, enabled } = input;

    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      return { ok: false, error: `仓库 ${warehouseId} 不存在` };
    }

    const container = warehouse.containers[containerId];
    if (!container) {
      return { ok: false, error: `容器 ${containerId} 不属于仓库 ${warehouseId}` };
    }

    const updated = {
      ...warehouse,
      containers: {
        ...warehouse.containers,
        [containerId]: {
          ...container,
          ...(role !== null && role !== undefined && { role }),
          ...(enabled !== null && enabled !== undefined && { enabled }),
          updatedAt: Date.now(),
        },
      },
    };

    this.repository.save(updated as any);
    this.runtimeRegistry.markDirty(warehouseId);

    return { ok: true };
  }
}
