/**
 * ============================================================================
 * WarehouseStatsService —— 容器统计计算与缓存（基础设施层）
 * ============================================================================
 *
 * 职责：
 * 1. 扫描 Minecraft 容器，计算每个容器的槽位使用率、物品数、种类数等统计
 * 2. 缓存机制：内存缓存 + DynamicProperty 持久化，崩溃重启后无需全量重扫
 * 3. 被 SorterEngine 在每次成功写入后调用 refreshContainerStats 保持数据同步
 * ============================================================================
 */

import { world, type Container } from "@minecraft/server";
import type { ContainerId, ContainerStats, StoredContainer, WarehouseData, WarehouseId } from "../types";
import { getContainerFromStored } from "../sorting/io/ContainerAccess";
import { WarehouseStatsStore } from "../persistence/WarehouseStatsStore";
import { CAPACITY_WARNING_THRESHOLD } from "../sorting/algorithm/CapacityWarning";

// ─── 持久化层 ──────────────────────────────────────────────────

const statsStore = new WarehouseStatsStore();

// ─── 运行时缓存 ──────────────────────────────────────────────────

/** 每个仓库 → { containerId → 统计 } 的内存缓存 */
const containerCache = new Map<WarehouseId, Map<ContainerId, ContainerStats>>();

// ─── 按角色分组的统计类型 ──────────────────────────────────────

export interface RoleStats {
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  hasWarning: boolean;
}

/** 仓库级别的完整统计 */
export interface WarehouseStats {
  displayName: string;
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  usagePercent: number;
  totalItems: number;
  uniqueTypes: number;
  hasWarning: boolean;
  byRole: Partial<Record<string, RoleStats>>;
  enabledFamiliesCount: number;
}

// ─── 公开 API ────────────────────────────────────────────────────

/**
 * 直接将容器统计写入缓存 + DP。
 * 用于容器设置页等已有现场扫描数据的场景，避免重复扫描。
 */
export function setContainerStats(
  warehouseId: WarehouseId,
  containerId: ContainerId,
  stats: ContainerStats
): void {
  let whCache = containerCache.get(warehouseId);
  if (!whCache) {
    whCache = new Map();
    containerCache.set(warehouseId, whCache);
  }
  whCache.set(containerId, stats);
  statsStore.saveContainerStats(warehouseId, containerId, stats);
}

/**
 * 标记整个仓库的统计缓存失效（清空内存缓存 + DP）。
 * 这是唯一的"触发全仓扫描"方式——下次 getWarehouseStats 会全部重算。
 */
export function invalidateWarehouseStats(warehouseId: WarehouseId, containerIds?: ContainerId[]): void {
  containerCache.delete(warehouseId);
  if (containerIds) {
    statsStore.deleteAllWarehouseStats(warehouseId, containerIds);
  }
}

/**
 * 获取单个容器的缓存统计。
 * 优先读内存缓存，未命中则尝试从 DP 加载，都无则计算并持久化。
 */
export function getOrComputeContainerStats(
  warehouse: WarehouseData,
  stored: StoredContainer
): ContainerStats | undefined {
  const cached = containerCache.get(warehouse.id)?.get(stored.id);
  if (cached) return cached;

  const persisted = statsStore.loadContainerStats(warehouse.id, stored.id);
  if (persisted) {
    let whCache = containerCache.get(warehouse.id);
    if (!whCache) {
      whCache = new Map();
      containerCache.set(warehouse.id, whCache);
    }
    whCache.set(stored.id, persisted);
    return persisted;
  }

  const fresh = computeContainerStats(warehouse.dimensionId, stored);
  if (!fresh) return undefined;

  let whCache = containerCache.get(warehouse.id);
  if (!whCache) {
    whCache = new Map();
    containerCache.set(warehouse.id, whCache);
  }
  whCache.set(stored.id, fresh);
  statsStore.saveContainerStats(warehouse.id, stored.id, fresh);

  return fresh;
}

/**
 * 分拣写入后立即重算单个容器的统计并持久化。
 * 由 SorterEngine 在每次成功写入容器后调用。
 */
export function refreshContainerStats(
  warehouse: WarehouseData,
  stored: StoredContainer
): ContainerStats | undefined {
  const fresh = computeContainerStats(warehouse.dimensionId, stored);
  if (!fresh) return undefined;

  let whCache = containerCache.get(warehouse.id);
  if (!whCache) {
    whCache = new Map();
    containerCache.set(warehouse.id, whCache);
  }
  whCache.set(stored.id, fresh);
  statsStore.saveContainerStats(warehouse.id, stored.id, fresh);
  return fresh;
}

/**
 * 获取仓库级别的完整统计。
 * 优先读缓存，被脏标记的容器增量重算。
 */
export function getWarehouseStats(warehouse: WarehouseData): WarehouseStats {
  const byRole: Partial<Record<string, RoleStats>> = {};
  let totalSlots = 0;
  let usedSlots = 0;
  let totalItems = 0;
  let hasWarning = false;
  let containerCount = 0;

  for (const stored of Object.values(warehouse.containers)) {
    const stats = getOrComputeContainerStats(warehouse, stored);
    if (!stats) continue;
    containerCount++;

    totalSlots += stats.totalSlots;
    usedSlots += stats.usedSlots;
    totalItems += stats.totalItems;
    if (stats.isWarning) hasWarning = true;

    const existing = byRole[stats.role] ?? {
      containerCount: 0, totalSlots: 0, usedSlots: 0,
      totalItems: 0, uniqueTypes: 0, hasWarning: false,
    };
    existing.containerCount++;
    existing.totalSlots += stats.totalSlots;
    existing.usedSlots += stats.usedSlots;
    existing.totalItems += stats.totalItems;
    existing.uniqueTypes += stats.uniqueTypes;
    existing.hasWarning = existing.hasWarning || stats.isWarning;
    byRole[stats.role] = existing;
  }

  const approxUniqueTypes = Object.values(byRole).reduce((s, r) => s + (r?.uniqueTypes ?? 0), 0);

  return {
    displayName: warehouse.displayName,
    containerCount,
    totalSlots,
    usedSlots,
    usagePercent: totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0,
    totalItems,
    uniqueTypes: approxUniqueTypes,
    hasWarning,
    byRole,
    enabledFamiliesCount: (warehouse.settings.enabledFamilies ?? []).length,
  };
}

/**
 * 检查容器是否处于容量告急状态。
 */
export function isContainerNearFull(container: Container): boolean {
  let usedSlots = 0;
  for (let slot = 0; slot < container.size; slot++) {
    try {
      if (container.getItem(slot)) usedSlots++;
    } catch { /* 跳过 */ }
  }
  return container.size > 0 && usedSlots / container.size >= CAPACITY_WARNING_THRESHOLD;
}

/**
 * 快速检查容器是否已满。
 */
export function isContainerFull(container: Container): boolean {
  return container.emptySlotsCount === 0;
}

// ─── 内部计算 ──────────────────────────────────────────────────

function computeContainerStats(
  dimensionId: string,
  container: StoredContainer
): ContainerStats | undefined {
  try {
    const dimension = world.getDimension(dimensionId);
    const mcContainer = getContainerFromStored(dimension, container);
    if (!mcContainer) return undefined;

    const totalSlots = mcContainer.size;
    let usedSlots = 0;
    let totalItems = 0;
    const uniqueTypesSet = new Set<string>();

    for (let slot = 0; slot < totalSlots; slot++) {
      try {
        const stack = mcContainer.getItem(slot);
        if (stack) {
          usedSlots++;
          totalItems += stack.amount;
          uniqueTypesSet.add(stack.typeId);
        }
      } catch { /* 跳过 */ }
    }

    const blockType = getBlockTypeLabel(dimension, container.primaryLocation);
    const usage = totalSlots > 0 ? usedSlots / totalSlots : 0;

    return {
      containerId: container.id,
      blockType,
      role: container.role,
      totalSlots,
      usedSlots,
      totalItems,
      uniqueTypes: uniqueTypesSet.size,
      isWarning: usage >= CAPACITY_WARNING_THRESHOLD,
    };
  } catch {
    return undefined;
  }
}

function getBlockTypeLabel(dimension: import("@minecraft/server").Dimension, location: import("../types").BlockLocation): string {
  try {
    const block = dimension.getBlock(location);
    if (block) return block.typeId.replace("minecraft:", "");
  } catch { /* 默认 */ }
  return "unknown";
}
