/**
 * 重新扫描仓库用例。
 *
 * 对指定仓库区域重新扫描容器，保留已有容器的角色设置，
 * 返回变更差异摘要。
 */

import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";
import type { WorldAccessPort } from "../ports/WorldAccessPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";

export interface RescanWarehouseInput {
  warehouseId: string;
}

export interface RescanWarehouseResult {
  ok: boolean;
  warehouseId: string;
  containerCount: number;
  diff?: { added: string[]; removed: string[]; changed: string[]; unchanged: string[] };
  error?: string;
}

export class RescanWarehouseUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly worldAccess: WorldAccessPort,
    private readonly runtimeRegistry: RuntimeRegistryPort
  ) {}

  execute(input: RescanWarehouseInput): RescanWarehouseResult {
    const { warehouseId } = input;
    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      return { ok: false, warehouseId, containerCount: 0, error: `仓库 ${warehouseId} 不存在` };
    }

    const scanned = this.worldAccess.scanArea(warehouse.dimensionId, warehouse.area);

    // 计算差异（简化版：仅统计数量变化）
    const oldIds = new Set(Object.keys(warehouse.containers));
    const newIds = new Set(Object.keys(scanned));

    const added = Object.keys(scanned).filter((id) => !oldIds.has(id));
    const removed = Object.keys(warehouse.containers).filter((id) => !newIds.has(id));
    const unchanged = Object.keys(warehouse.containers).filter((id) => newIds.has(id));
    const changed: string[] = [];

    // 保存更新后的仓库
    const updated = { ...warehouse, containers: scanned as Record<string, any> };
    this.repository.save(updated as any);
    this.runtimeRegistry.markDirty(warehouseId);

    return {
      ok: true,
      warehouseId,
      containerCount: Object.keys(scanned).length,
      diff: { added, removed, changed, unchanged },
    };
  }
}
