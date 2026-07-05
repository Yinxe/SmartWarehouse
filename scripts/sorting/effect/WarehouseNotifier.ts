/**
 * ============================================================================
 * WarehouseNotifier —— 仓库通知工具
 * ============================================================================
 *
 * 负责向仓库附近的玩家发送消息和预警。
 * 与分拣引擎解耦，使 SorterEngine 专注于核心排序逻辑。
 * ============================================================================
 */

import { world } from "@minecraft/server";
import type { WarehouseData, ContainerId } from "../../types";
import { getOrComputeContainerStats, refreshContainerStats } from "../../warehouse/WarehouseStatsService";
import { isNearAreaXZ } from "../../util/Vector";
import { CAPACITY_WARNING_THRESHOLD } from "../algorithm/CapacityWarning";

/**
 * 通知器——管理冷却状态和玩家消息。
 */
export class WarehouseNotifier {
  /** 冷却映射：key → 上次通知的 tick */
  private readonly cooldowns = new Map<string, number>();
  /** 冷却 tick 数（5 秒 = 100 tick） */
  private static readonly COOLDOWN_TICKS = 100;

  // ─── 容量预警 ──────────────────────────────────────────────

  /**
   * 检查候选容器组的总容量并触发预警。
   */
  checkGroupCapacity(
    warehouse: WarehouseData,
    candidates: ContainerId[],
    typeId: string,
    levelLabel: string,
    modifiedIds: Set<ContainerId>,
    currentTick: number
  ): void {
    if (!warehouse.settings.capacityWarning) return;
    if (candidates.length === 0) return;

    const key = `group:${warehouse.id}:${levelLabel}:${typeId}`;
    const last = this.cooldowns.get(key) ?? 0;
    const cooldownActive = currentTick - last < WarehouseNotifier.COOLDOWN_TICKS;

    let totalUsed = 0;
    let totalSlots = 0;
    const details: { id: string; pct: number }[] = [];

    for (const cid of candidates) {
      const stored = warehouse.containers[cid];
      if (!stored) continue;

      const stats = modifiedIds.has(cid)
        ? refreshContainerStats(warehouse, stored)
        : getOrComputeContainerStats(warehouse, stored);
      if (!stats) continue;

      totalUsed += stats.usedSlots;
      totalSlots += stats.totalSlots;

      if (stats.isWarning) {
        const pct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
        details.push({ id: cid.slice(-8), pct });
      }
    }

    if (totalSlots === 0 || totalUsed / totalSlots < CAPACITY_WARNING_THRESHOLD) return;
    if (cooldownActive) return;

    this.cooldowns.set(key, currentTick);
    const list = details.length > 0
      ? details.map((c, i) => `#${i + 1}-${c.id}(${c.pct}%)`).join(" ")
      : "（无单容器超阈值，但组总容量已满）";
    const pct = Math.round((totalUsed / totalSlots) * 100);
    this.sendWarn(warehouse, `类型:${levelLabel} 物品:${typeId} 组容量:${pct}% 容器:${list} 总容量已达阈值`);
  }

  /**
   * 降级预警：匹配的容器组达到容量上限，物品溢出到低优先级容器。
   */
  warnOverflow(warehouse: WarehouseData, typeId: string, fromLevel: string, toLevel: string, currentTick: number): void {
    const key = `overflow:${warehouse.id}:${fromLevel}->${toLevel}`;
    if (this.isOnCooldown(key, WarehouseNotifier.COOLDOWN_TICKS, currentTick)) return;
    this.sendWarn(warehouse, `§c${typeId} ${fromLevel}容器组已满，降级至${toLevel}，请整理或扩容`);
  }

  /**
   * 全满预警：所有容器放不下，物品滞留在输入容器。
   */
  warnAllFull(warehouse: WarehouseData, typeId: string, currentTick: number): void {
    const key = `allfull:${warehouse.id}`;
    if (this.isOnCooldown(key, WarehouseNotifier.COOLDOWN_TICKS * 3, currentTick)) return;
    this.sendWarn(warehouse, `§c${typeId} 无法分类！所有容器已满，请手动整理杂项容器或扩容`);
  }

  // ─── 消息发送 ──────────────────────────────────────────────

  /** 向仓库附近玩家发送预警消息（红色前缀）。 */
  sendWarn(warehouse: WarehouseData, message: string): void {
    this.sendToNearby(warehouse, `§c[仓库]§r ${message}`);
  }

  /** 向仓库附近玩家发送信息消息（绿色前缀）。 */
  sendInfo(warehouse: WarehouseData, message: string): void {
    this.sendToNearby(warehouse, `§a[仓库]§r ${message}`);
  }

  private sendToNearby(warehouse: WarehouseData, message: string): void {
    try {
      for (const player of world.getPlayers()) {
        if (player.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: player.location.x, z: player.location.z }, warehouse.area, 8)) {
          try { player.sendMessage(message); } catch { /* 忽略 */ }
        }
      }
    } catch { /* 忽略 */ }
  }

  // ─── 冷却管理 ──────────────────────────────────────────────

  private isOnCooldown(key: string, ticks: number, currentTick: number): boolean {
    const last = this.cooldowns.get(key) ?? 0;
    if (currentTick - last < ticks) return true;
    this.cooldowns.set(key, currentTick);
    return false;
  }
}
