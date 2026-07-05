/**
 * ============================================================================
 * ContainerSelector —— 容器选择器（分拣路由核心）
 * ============================================================================
 *
 * 职责：
 * 根据物品类型和仓库状态，找出最适合存放该物品的容器。
 * 不关心"放进去"之后的流程，只负责"放哪里"和"放进去"。
 *
 * 与 SorterEngine 的区别：
 * - SorterEngine 是编排器（加载数据→选容器→处理结果→循环）
 * - ContainerSelector 是策略器（给定物品+仓库→推荐容器）
 * ============================================================================
 */

import { Container, Dimension, ItemStack } from "@minecraft/server";
import type { ContainerId, WarehouseData, WarehouseRuntimeModel } from "../types";
import { getFamily, getFamilyById } from "../data/ItemFamilies";
import { Logger } from "../util/Logger";
import { playSortEffect } from "./effect/SortEffects";
import { SlotOrganizer } from "./io/SlotOrganizer";
import { MoveJournal } from "./io/MoveJournal";
import {
  getContainerFromStored,
  tryMoveStackIntoContainer,
  tryMoveStackIntoContainerWithJournal,
} from "./io/ContainerAccess";
import { containerHasType, getFamilyPurity, isContainerEmpty } from "./algorithm/ContainerView";

const log = new Logger("ContainerSelector");

export class ContainerSelector {
  constructor(private readonly organizer?: SlotOrganizer) {}

  // ═══════════════════════════════════════════════════════════════
  // 尝试将物品放入候选容器
  // ═══════════════════════════════════════════════════════════════

  /**
   * 遍历候选容器列表，尝试将剩余物品堆放入每个容器。
   *
   * @returns 剩余物品堆 + 本次被修改的容器 ID 集合
   */
  tryPlaceInContainers(
    stack: ItemStack | undefined,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    journal: MoveJournal,
    tag?: string
  ): { remaining: ItemStack | undefined; modifiedIds: Set<ContainerId> } {
    if (!stack) return { remaining: undefined, modifiedIds: new Set() };

    let remaining: ItemStack | undefined = stack;
    const modifiedIds = new Set<ContainerId>();

    for (const containerId of containerIds) {
      const stored = warehouse.containers[containerId];
      if (!stored) continue;
      const loc = stored.primaryLocation;

      const targetContainer = getContainerFromStored(dimension, stored);
      if (!targetContainer) {
        log.info(`[${tag ?? "?"}] ${containerId} @ (${loc.x},${loc.y},${loc.z}) — 容器不可达，跳过`);
        continue;
      }

      const beforeAmount = remaining.amount;
      remaining = tryMoveStackIntoContainerWithJournal(remaining, targetContainer, journal, containerId);

      const placed = beforeAmount - (remaining?.amount ?? 0);
      if (placed > 0) {
        modifiedIds.add(containerId);
        let purityLog = "";
        if (tag === "family") {
          const purFamily = getFamily(stack.typeId);
          if (purFamily) {
            const purity = getFamilyPurity(targetContainer, new Set(purFamily.items));
            purityLog = ` (纯度${(purity * 100).toFixed(0)}%)`;
          }
        }
        log.info(
          `[${tag ?? "?"}]${purityLog} ${stack.typeId} x${placed} → ${containerId} (角色=${stored.role}) @ (${loc.x},${loc.y},${loc.z})`
        );
        this.addToTypeIndex(model, stack.typeId, containerId);

        const placedFamily = getFamily(stack.typeId);
        if (placedFamily && (warehouse.settings.enabledFamilies ?? []).includes(placedFamily.id)) {
          this.addToFamilyIndex(model, placedFamily.id, containerId);
        }

        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(targetContainer, containerId, warehouse.settings.autoSortThreshold / 100);
      }

      if (remaining === undefined) return { remaining: undefined, modifiedIds };
    }

    return { remaining, modifiedIds };
  }

  /**
   * 尝试将物品放入大宗容器中。
   * 大宗容器专用于单一物品类型，混合存储潜影盒与散装物品。
   */
  tryPlaceInBulkContainers(
    stack: ItemStack | undefined,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    dimension: Dimension,
    journal: MoveJournal
  ): { remaining: ItemStack | undefined; modifiedIds: Set<ContainerId> } {
    if (!stack) return { remaining: undefined, modifiedIds: new Set() };

    let remaining: ItemStack | undefined = stack;
    const modifiedIds = new Set<ContainerId>();

    for (const containerId of containerIds) {
      if (remaining === undefined) return { remaining: undefined, modifiedIds };

      const stored = warehouse.containers[containerId];
      if (!stored) continue;
      const loc = stored.primaryLocation;

      const target = getContainerFromStored(dimension, stored);
      if (!target) {
        log.info(`[bulk] ${containerId} @ (${loc.x},${loc.y},${loc.z}) — 容器不可达，跳过`);
        continue;
      }

      const beforeAmount = remaining.amount;
      journal.snapshotTarget(containerId, target);

      remaining = tryMoveStackIntoContainer(remaining, target);

      const placed = beforeAmount - (remaining?.amount ?? 0);
      if (placed > 0) {
        modifiedIds.add(containerId);
        log.info(`[bulk] ${stack.typeId} x${placed} → ${containerId} @ (${loc.x},${loc.y},${loc.z})`);
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
      }

      if (remaining === undefined) return { remaining: undefined, modifiedIds };
    }

    return { remaining, modifiedIds };
  }

  // ═══════════════════════════════════════════════════════════════
  // itemTypeIndex 索引辅助方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 查找当前仓库中已包含指定物品类型的普通容器。
   * 采用惰性校验 + 自动修复策略分 4 个阶段执行。
   */
  findExistingTypeContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    typeId: string,
    dimension: Dimension
  ): ContainerId[] {
    const hasIndexEntry = model.itemTypeIndex.has(typeId);

    // 阶段 1：校验候选容器
    const { valid, stale } = this.validateIndexCandidates(
      hasIndexEntry,
      hasIndexEntry ? model.itemTypeIndex.get(typeId)! : model.normalContainerIds,
      warehouse,
      typeId,
      dimension
    );

    // 阶段 2：惰性清除脏索引
    if (hasIndexEntry && stale.size > 0) {
      this.cleanStaleIndexEntries(model, typeId, stale);
    }

    // 阶段 3：索引全脏后的零延迟回退
    if (hasIndexEntry && stale.size > 0 && valid.length === 0) {
      this.fullScanNormalContainers(warehouse, model, typeId, dimension, valid);
    }

    // 阶段 4：学习新发现的容器到索引
    if (!hasIndexEntry && valid.length > 0) {
      model.itemTypeIndex.set(typeId, [...valid]);
    }

    return valid;
  }

  /**
   * 校验候选容器列表中哪些仍然有效，哪些已过时。
   */
  private validateIndexCandidates(
    hasIndexEntry: boolean,
    candidates: ContainerId[],
    warehouse: WarehouseData,
    typeId: string,
    dimension: Dimension
  ): { valid: ContainerId[]; stale: Set<ContainerId> } {
    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();

    for (const containerId of candidates) {
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) {
        if (hasIndexEntry) stale.add(containerId);
        continue;
      }

      const container = getContainerFromStored(dimension, stored);
      if (!container) {
        if (hasIndexEntry) valid.push(containerId);
        continue;
      }

      if (isContainerEmpty(container)) {
        if (hasIndexEntry) stale.add(containerId);
        continue;
      }

      if (containerHasType(container, typeId)) {
        valid.push(containerId);
      } else if (hasIndexEntry) {
        stale.add(containerId);
      }
    }

    return { valid, stale };
  }

  /**
   * 从索引中惰性清除脏条目。
   */
  private cleanStaleIndexEntries(model: WarehouseRuntimeModel, typeId: string, stale: Set<ContainerId>): void {
    const candidates = model.itemTypeIndex.get(typeId);
    if (!candidates) return;

    const updated = candidates.filter((id: string) => !stale.has(id));
    if (updated.length > 0) {
      model.itemTypeIndex.set(typeId, updated);
    } else {
      model.itemTypeIndex.delete(typeId);
    }
  }

  /**
   * 全量扫描所有 normal 容器，查找包含指定物品类型的容器。
   */
  private fullScanNormalContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    typeId: string,
    dimension: Dimension,
    result: ContainerId[]
  ): void {
    for (const containerId of model.normalContainerIds) {
      if (result.includes(containerId)) continue;
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) continue;
      const container = getContainerFromStored(dimension, stored);
      if (!container) continue;
      if (isContainerEmpty(container)) continue;
      if (containerHasType(container, typeId)) {
        result.push(containerId);
      }
    }

    if (result.length > 0) {
      model.itemTypeIndex.set(typeId, [...result]);
    }
  }

  /**
   * 查找已包含指定同族物品的普通容器。
   */
  findExistingFamilyContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    familyId: string,
    dimension: Dimension
  ): ContainerId[] {
    const family = getFamilyById(familyId);
    if (!family) return [];

    const memberSet = new Set(family.items);
    const candidates = model.familyTypeIndex.get(familyId);
    const hasIndex = candidates !== undefined && candidates.length > 0;

    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();
    const containerCache = new Map<ContainerId, Container>();

    if (hasIndex) {
      for (const containerId of candidates) {
        const stored = warehouse.containers[containerId];
        if (!stored || stored.role !== "normal" || !stored.enabled) {
          stale.add(containerId);
          continue;
        }

        const container = getContainerFromStored(dimension, stored);
        if (!container) {
          valid.push(containerId);
          continue;
        }

        let hasFamilyItem = false;
        for (const typeId of family.items) {
          if (containerHasType(container, typeId)) {
            hasFamilyItem = true;
            break;
          }
        }

        if (hasFamilyItem) {
          valid.push(containerId);
          containerCache.set(containerId, container);
        } else {
          stale.add(containerId);
        }
      }

      if (stale.size > 0) {
        const updated = candidates.filter((id: string) => !stale.has(id));
        if (updated.length > 0) {
          model.familyTypeIndex.set(familyId, updated);
        } else {
          model.familyTypeIndex.delete(familyId);
        }
      }
    }

    const needsFullScan = !hasIndex || (valid.length === 0 && stale.size > 0);
    if (!needsFullScan) {
      return this.sortByFamilyPurity(valid, memberSet, containerCache);
    }

    for (const containerId of model.normalContainerIds) {
      if (hasIndex && candidates.includes(containerId)) continue;
      const stored = warehouse.containers[containerId];
      if (!stored || stored.role !== "normal" || !stored.enabled) continue;
      const container = getContainerFromStored(dimension, stored);
      if (!container) continue;
      for (const typeId of family.items) {
        if (containerHasType(container, typeId)) {
          valid.push(containerId);
          containerCache.set(containerId, container);
          break;
        }
      }
    }

    if (valid.length > 0) {
      model.familyTypeIndex.set(familyId, [...valid]);
    }

    return this.sortByFamilyPurity(valid, memberSet, containerCache);
  }

  /**
   * 查找一个空的 normal 容器，用于自动创建新分类。
   */
  findEmptyNormalContainer(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension
  ): ContainerId | undefined {
    for (const containerId of model.normalContainerIds) {
      const stored = warehouse.containers[containerId];
      if (!stored || !stored.enabled) continue;
      const target = getContainerFromStored(dimension, stored);
      if (!target) continue;
      if (isContainerEmpty(target)) return containerId;
    }
    return undefined;
  }

  /**
   * 从指定槽位开始查找下一个非空槽位。
   */
  findNextNonEmptySlot(container: Container, startSlot: number): number {
    for (let i = 1; i < container.size; i++) {
      const checkSlot = (startSlot + i) % container.size;
      const item = container.getItem(checkSlot);
      if (item) return checkSlot;
    }
    return (startSlot + 1) % container.size;
  }

  // ─── 索引辅助 ──────────────────────────────────────────────

  private addToTypeIndex(model: WarehouseRuntimeModel, typeId: string, containerId: ContainerId): void {
    const existing = model.itemTypeIndex.get(typeId);
    if (existing) {
      if (!existing.includes(containerId)) existing.push(containerId);
    } else {
      model.itemTypeIndex.set(typeId, [containerId]);
    }
  }

  private addToFamilyIndex(model: WarehouseRuntimeModel, familyId: string, containerId: ContainerId): void {
    const existing = model.familyTypeIndex.get(familyId);
    if (existing) {
      if (!existing.includes(containerId)) existing.push(containerId);
    } else {
      model.familyTypeIndex.set(familyId, [containerId]);
    }
  }

  /**
   * 按家族纯度对候选容器列表降序排序。
   */
  private sortByFamilyPurity(
    containerIds: ContainerId[],
    memberSet: Set<string>,
    containerCache: Map<ContainerId, Container>
  ): ContainerId[] {
    if (containerIds.length <= 1) return containerIds;

    const scored: { id: ContainerId; purity: number; index: number }[] = [];
    let hasPositivePurity = false;

    for (let i = 0; i < containerIds.length; i++) {
      const containerId = containerIds[i];
      const container = containerCache.get(containerId);
      if (!container) {
        scored.push({ id: containerId, purity: 0, index: i });
        continue;
      }
      const purity = getFamilyPurity(container, memberSet);
      if (purity > 0) hasPositivePurity = true;
      scored.push({ id: containerId, purity, index: i });
    }

    if (!hasPositivePurity) return containerIds;

    scored.sort((a, b) => b.purity - a.purity || a.index - b.index);
    return scored.map((s) => s.id);
  }
}
