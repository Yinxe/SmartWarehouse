/**
 * 仓库运行时注册表 —— 内存索引缓存（基础设施层）。
 *
 * 所有对仓库运行时模型的访问必须通过此注册表。
 * 缓存模型保留在内存中，通过 dirty 标记触发惰性重建。
 */

import type { WarehouseId, WarehouseData } from "../../types";
import type { WarehouseRuntimeModel } from "../../domain/warehouse/WarehouseRuntimeModel";
import { buildWarehouseRuntimeModel } from "../../domain/warehouse/WarehouseRuntimeModel";

export class WarehouseRuntimeRegistry {
  /** 仓库 ID → 运行时模型的映射 */
  private readonly models = new Map<WarehouseId, WarehouseRuntimeModel>();

  /**
   * @param loadWarehouse 加载仓库数据的回调，从持久化存储获取
   */
  constructor(
    private readonly loadWarehouse: (id: WarehouseId) => WarehouseData | undefined
  ) {}

  /**
   * 获取或构建指定仓库的运行时模型。
   *
   * 如果缓存中存在且未标记为脏（dirty），直接返回缓存。
   * 否则从持久化存储加载仓库数据并构建新的运行时模型。
   * 构建时会保留旧的 inputCursor，并在新模型的输入容器列表上取模以保证游标不越界。
   *
   * @param id 仓库 ID
   * @returns 运行时模型，如果仓库不存在则返回 undefined
   */
  getOrBuild(id: WarehouseId): WarehouseRuntimeModel | undefined {
    const existing = this.models.get(id);
    if (existing && !existing.dirty) return existing;

    const warehouse = this.loadWarehouse(id);
    if (!warehouse) return undefined;

    const model = buildWarehouseRuntimeModel(warehouse);
    // 保留旧的 inputCursor，并在新模型的输入容器数量上取模，防止数组越界
    const oldCursor = existing?.inputCursor ?? 0;
    model.inputCursor = model.inputContainerIds.length > 0 ? oldCursor % model.inputContainerIds.length : 0;
    this.models.set(id, model);
    return model;
  }

  /**
   * 将指定仓库的运行时模型标记为脏（dirty）。
   *
   * @param id 仓库 ID
   */
  markDirty(id: WarehouseId): void {
    const model = this.models.get(id);
    if (model) model.dirty = true;
  }

  /**
   * 从内存缓存中移除指定仓库的运行时模型。
   *
   * @param id 仓库 ID
   */
  delete(id: WarehouseId): void {
    this.models.delete(id);
  }

  /**
   * 清空所有缓存（调试/重置用）。
   */
  clear(): void {
    this.models.clear();
  }
}
