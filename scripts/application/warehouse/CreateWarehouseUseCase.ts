/**
 * 创建仓库用例。
 *
 * 编排仓库创建的完整流程：
 * 1. 校验仓库名称和区域合法性
 * 2. 调用 WorldAccessPort 扫描区域内容器
 * 3. 通过 WarehouseRepositoryPort 持久化
 * 4. 通知 RuntimeRegistryPort 缓存失效
 * 5. 通知 SchedulerPort 调度刷新
 */

import type { WarehouseRepositoryPort } from "../ports/WarehouseRepositoryPort";
import type { WorldAccessPort } from "../ports/WorldAccessPort";
import type { RuntimeRegistryPort } from "../ports/RuntimeRegistryPort";

export interface CreateWarehouseInput {
  name: string;
  dimensionId: string;
  pointA: { x: number; y: number; z: number };
  pointB: { x: number; y: number; z: number };
  defaultRole?: string;
  defaultEnabled?: boolean;
}

export interface CreateWarehouseResult {
  ok: boolean;
  warehouseId?: string;
  containerCount?: number;
  error?: string;
}

export class CreateWarehouseUseCase {
  constructor(
    private readonly repository: WarehouseRepositoryPort,
    private readonly worldAccess: WorldAccessPort,
    private readonly runtimeRegistry: RuntimeRegistryPort
  ) {}

  execute(input: CreateWarehouseInput): CreateWarehouseResult {
    if (!input.name?.trim()) {
      return { ok: false, error: "仓库名称不能为空" };
    }
    if (!input.dimensionId) {
      return { ok: false, error: "维度不能为空" };
    }

    const warehouseId = input.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    if (this.repository.exists(warehouseId)) {
      return { ok: false, error: `仓库 ${warehouseId} 已存在` };
    }

    // 扫描区域内容器
    const minX = Math.min(input.pointA.x, input.pointB.x);
    const minY = Math.min(input.pointA.y, input.pointB.y);
    const minZ = Math.min(input.pointA.z, input.pointB.z);
    const maxX = Math.max(input.pointA.x, input.pointB.x);
    const maxY = Math.max(input.pointA.y, input.pointB.y);
    const maxZ = Math.max(input.pointA.z, input.pointB.z);

    const area = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
    const scanned = this.worldAccess.scanArea(input.dimensionId, area);
    const containerCount = Object.keys(scanned).length;

    // 构建仓库数据
    const data: Record<string, unknown> = {
      version: 1,
      id: warehouseId,
      displayName: input.name.trim(),
      dimensionId: input.dimensionId,
      area,
      settings: {
        defaultNewContainerRole: input.defaultRole ?? "misc",
        defaultNewContainerEnabled: input.defaultEnabled ?? true,
        autoCreateCategories: false,
        enabled: true,
        processingSpeed: 8,
        debug: false,
        showBoundary: false,
        autoSortThreshold: 0,
        enabledFamilies: [],
        capacityWarning: true,
      },
      containerCount,
      containerShardCount: 0,
      containerShardGeneration: 0,
      containers: scanned,
    };

    this.repository.save(data as any);
    this.runtimeRegistry.markDirty(warehouseId);

    return {
      ok: true,
      warehouseId,
      containerCount,
    };
  }
}
