import { Container, Dimension, ItemStack, system, world } from "@minecraft/server";
import { getFamily } from "../../data/ItemFamilies";
import { WarehouseRuntimeRegistry } from "../cache/WarehouseRuntimeRegistry";
import { WarehouseRepository } from "../persistence/WarehouseRepository";
import type { ContainerId, WarehouseData, WarehouseId, WarehouseRuntimeModel } from "../../types";
import { Logger } from "../Logger";
import { isNearAreaXZ } from "../../domain/shared/Vector";
import {
    getBulkChestFirstType,
    getContainerFromStored,
} from "./container/ContainerAccess";
import { isContainerEmpty } from "../../domain/inventory/ContainerView";
import { MoveJournal } from "./container/MoveJournal";
import { SlotOrganizer } from "./container/SlotOrganizer";
import { ContainerSelector } from "./container/ContainerSelector";
import { getOrComputeContainerStats, refreshContainerStats } from "../WarehouseStatsService";

const log = new Logger("SorterEngine");

/**
 * 分拣引擎 —— 将物品从输入容器分拣到对应的存储容器（普通 / 杂项）中。
 *
 * ### 分拣优先级（每个物品堆）
 *
 * 按照以下优先级依次尝试放置物品：
 *
 * 1. **大宗容器**（单物品——专收单一类型高产量物品，盒箱混存。空箱需玩家配置 bulkTypeId）
 * 2. **已有同类物品的普通容器**（多物品——优先利用运行时 `itemTypeIndex` 索引快速查找）
 * 3. **同族物品的普通容器**（家庭同族——仅当物品所属族在 `enabledFamilies` 中启用时生效）
 * 4. **空的普通容器**（自动创建分类——仅在 `autoCreateCategories` 开启时启用）
 * 5. **杂项容器**（兜底，任何物品最终都能放入杂项容器）
 *
 * ### 设计要点
 *
 * - **索引自愈机制**：`itemTypeIndex` 是一个运行时缓存，记录每个物品种类对应的容器列表。
 *   当容器被搬空或更换后索引可能过时，`findExistingTypeContainers` 会在每次查询时
 *   校验索引项的有效性并惰性清除脏数据，同时将新发现的容器写回索引。
 * - **双遍扫描**：对于没有索引记录的物品种类，会回退为全量扫描所有普通容器，
 *   扫描结果会被写入索引，后续同种类物品的分拣走快速路径。
 * - **容错性**：每个输入容器的处理都在 try-catch 中，单个容器不可达（区块未加载、
 *   方块被破坏等）不会影响其他容器的分拣。
 */
export class SorterEngine {
  /** 容量预警冷却：容器 ID → 上次预警 tick */
  private readonly warningCooldowns = new Map<string, number>();
  private readonly selector: ContainerSelector;

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly runtime: WarehouseRuntimeRegistry,
    private readonly organizer?: SlotOrganizer
  ) {
    this.selector = new ContainerSelector(runtime, organizer);
  }

  // ─── 公开入口 ───────────────────────────────────────────────────

  /**
   * 处理指定仓库的下一轮分拣。
   *
   * 执行流程：
   * 1. 从仓库仓库（Repository）加载仓库数据。
   * 2. 检查仓库是否启用，若禁用则静默跳过。
   * 3. 构建或获取运行态模型（RuntimeModel），若构建失败则跳过。
   * 4. 若没有输入容器，直接返回。
   * 5. **轮询调度**：通过 `inputCursor` 游标选取当前输入容器，并前进游标。
   * 6. 调用 `processInputContainer` 处理该输入容器的第一个非空物品堆。
   *
   * @param warehouseId - 要处理的仓库 ID
   */
  processWarehouse(warehouseId: WarehouseId): void {
    const warehouse = this.repository.load(warehouseId);
    if (!warehouse) {
      log.error(`仓库 ${warehouseId} 未找到，跳过`);
      return;
    }

    // 仓库被禁用时不处理，静默跳过
    if (!warehouse.settings.enabled) {
      return;
    }

    const model = this.runtime.getOrBuild(warehouseId);
    if (!model) {
      log.error(`仓库 ${warehouseId} 的运行态模型构建失败，跳过`);
      return;
    }

    // 没有输入容器则无事可做
    if (model.inputContainerIds.length === 0) return;

    // 区块加载预检：每 40 tick（~2 秒）采样仓库区域角落，
    // 如果任何角落位于未加载区块，跳过本次分拣
    this.checkAreaLoaded(warehouse, model);
    if (model.areaLoaded === false) {
      return; // 区块未加载，静默跳过，下个周期重试
    }

    // 轮询调度：取模选取当前输入容器，游标 +1，实现多个输入容器间的负载均衡
    const inputIndex = model.inputCursor % model.inputContainerIds.length;
    const inputContainerId = model.inputContainerIds[inputIndex];
    model.inputCursor = (model.inputCursor + 1) % model.inputContainerIds.length;

    // ── 空闲→活跃过渡检测 ──
    // 如果仓库处于空闲状态但输入容器有物品，通知玩家并标记活跃
    if (model.idle) {
      const inputStored = warehouse.containers[inputContainerId];
      if (inputStored) {
        const dim = this.getDimensionSafe(warehouse.dimensionId);
        if (dim) {
          const inputContainer = getContainerFromStored(dim, inputStored);
          if (inputContainer && inputContainer.emptySlotsCount < inputContainer.size) {
            model.idle = false;
            this.sendInfoToNearby(warehouse, "§a仓库开始分拣物品");
          }
        }
      }
    }

    this.processInputContainer(warehouse, model, inputContainerId);

    // ── 活跃→空闲过渡检测 ──
    // 处理完毕后若当前输入容器已空，扫描所有输入容器判断是否全空
    if (!model.idle) {
      const theStored = warehouse.containers[inputContainerId];
      if (theStored) {
        const dim = this.getDimensionSafe(warehouse.dimensionId);
        if (dim) {
          const container = getContainerFromStored(dim, theStored);
          if (container && container.emptySlotsCount === container.size) {
            this.trySetIdle(warehouse, model);
          }
        }
      }
    }
  }

  /**
   * 释放指定仓库的运行时模型，回收内存。
   * 由 SortingScheduler 在仓库停用时调用。
   */
  releaseRuntime(warehouseId: WarehouseId): void {
    this.runtime.delete(warehouseId);
  }

  /**
   * 重置指定仓库的运行时游标。
   *
   * 将 inputCursor（输入容器轮询游标）归零，并清空 inputSlotCursors（各输入容器的
   * 槽位游标），确保仓库重新激活时从头开始处理，避免因游标越界或数据不一致导致跳过
   * 某些容器。
   *
   * @param warehouseId - 仓库 ID
   */
  resetCursors(warehouseId: WarehouseId): void {
    const model = this.runtime.getOrBuild(warehouseId);
    if (model) {
      model.inputCursor = 0;
      model.inputSlotCursors.clear();
    }
  }

  // ─── 区块加载预检 ──────────────────────────────────────────────

  /**
   * 采样仓库区域的 8 个角落检测区块是否已加载。
   *
   * **为何需要**：如果仓库所在区块全部或部分未加载，`getContainerFromStored`
   * 会逐个返回 undefined 并跳过，但逐个尝试效率低下。直接预检整个区域，如果
   * 有任何角落不可达，本次分拣直接跳过。
   *
   * **缓存策略**：每 40 tick（约 2 秒）才重新检查一次，避免每 tick 都采样。
   * 检查结果缓存在 `model.areaLoaded` 中。
   *
   * @param warehouse - 仓库数据（含区域信息）
   * @param model - 运行时模型（含缓存字段）
   */
  private checkAreaLoaded(warehouse: WarehouseData, model: WarehouseRuntimeModel): void {
    // 缓存有效期 40 tick ≈ 2 秒，避免每 tick 重复采样
    const RECHECK_INTERVAL = 40;
    if (model.areaLoaded !== undefined && system.currentTick - model.areaLoadedCheckedTick < RECHECK_INTERVAL) {
      return; // 缓存仍有效
    }

    const dimension = this.getDimensionSafe(warehouse.dimensionId);
    if (!dimension) {
      model.areaLoaded = false;
      model.areaLoadedCheckedTick = system.currentTick;
      return;
    }

    // 采样区域 8 个角落
    const { min, max } = warehouse.area;
    const corners: { x: number; y: number; z: number }[] = [
      { x: min.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: min.z },
      { x: min.x, y: min.y, z: max.z },
      { x: max.x, y: min.y, z: max.z },
      { x: min.x, y: max.y, z: min.z },
      { x: max.x, y: max.y, z: min.z },
      { x: min.x, y: max.y, z: max.z },
      { x: max.x, y: max.y, z: max.z },
    ];

    for (const corner of corners) {
      try {
        const block = dimension.getBlock(corner);
        if (!block) {
          model.areaLoaded = false;
          model.areaLoadedCheckedTick = system.currentTick;
          return;
        }
        // 访问 permutation 确认区块真正加载（getBlock 在部分版本可能返回占位对象）
        const _ = block.permutation;
      } catch {
        model.areaLoaded = false;
        model.areaLoadedCheckedTick = system.currentTick;
        return;
      }
    }

    model.areaLoaded = true;
    model.areaLoadedCheckedTick = system.currentTick;
  }

  // ─── 输入容器处理 ───────────────────────────────────────────────

  /**
   * 处理单个输入容器的分拣。
   *
   * 遍历容器中所有槽位，逐个尝试分拣。无法分类的物品**留在原地**，
   * 不会阻塞后续槽位的处理，且下个 tick 会再次尝试。
   *
   * 步骤（每个槽位）：
   * 1. 获取该槽位的物品堆。
   * 2. 调用 `moveStackIntoWarehouse` 尝试放入仓库中的存储容器。
   * 3. 根据返回值更新槽位：
   *    - `undefined`：整堆全部放完 → 清空槽位。
   *    - 剩余量 < 原来量 → 部分放入，余量写回槽位。
   *    - 剩余量 == 原来量 → 无法分类，保持不动，继续下一槽。
   *
   * **容错设计**：整个方法被 try-catch 包裹，确保单个容器异常不会瓦解调度循环。
   */
  private processInputContainer(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    containerId: ContainerId
  ): void {
    const journal = new MoveJournal();
    try {
      const stored = warehouse.containers[containerId];
      if (!stored) {
        log.error(`容器 ${containerId} 未在仓库 ${warehouse.id} 中找到`);
        return;
      }

      const dimension = this.getDimensionSafe(stored.dimensionId);
      if (!dimension) return;

      const container = getContainerFromStored(dimension, stored);
      if (!container) return;

      const loc = stored.primaryLocation;

      // ── 快速判空：输入容器全空 → 仓库进入空闲 ──
      // 当前输入容器为空 → 跳过，游标下个 interval 选下一个容器
      if (container.emptySlotsCount === container.size) return;

      // ── 槽位游标：取当前格 ──
      let slot = model.inputSlotCursors.get(containerId) ?? 0;
      if (slot >= container.size) slot = 0;

      const stack = container.getItem(slot);
      if (!stack) {
        const nextSlot = this.selector.findNextNonEmptySlot(container, slot);
        model.inputSlotCursors.set(containerId, nextSlot);
        return;
      }

      const originalAmount = stack.amount;
      log.info(`槽 ${slot}：${stack.typeId} x${originalAmount}`);

      const remaining = this.moveStackIntoWarehouse(stack, warehouse, model, dimension, journal);

      if (remaining === undefined) {
        // 整堆全部成功放置 → 清空输入槽位
        try {
          container.setItem(slot);
          log.info(`槽 ${slot} 已清空（全部 ${originalAmount} 个已放置）`);
        } catch (setError) {
          log.error(`致命错误：槽 ${slot} 清空失败，尝试回滚: ${setError}`);
          const rollResult = journal.rollback();
          if (rollResult.ok) {
            this.runtime.markDirty(warehouse.id);
            log.info(`回滚成功，已撤销本次分拣对目标容器的写入`);
          } else {
            warehouse.settings.enabled = false;
            this.repository.saveMetaOnly(warehouse);
            log.error(`仓库 ${warehouse.id} 已因分拣回滚失败而停用: ${rollResult.error}`);
          }
        }
      } else if (remaining.amount < originalAmount) {
        // 部分放置成功 → 余量写回槽位
        try {
          container.setItem(slot, remaining);
          log.info(`槽 ${slot} 部分放置：${remaining.amount}/${originalAmount} 返回`);
        } catch (setError) {
          log.error(`致命错误：槽 ${slot} 回写失败，尝试回滚: ${setError}`);
          const rollResult = journal.rollback();
          if (rollResult.ok) {
            this.runtime.markDirty(warehouse.id);
            log.info(`回滚成功，已撤销本次分拣对目标容器的写入`);
          } else {
            warehouse.settings.enabled = false;
            this.repository.saveMetaOnly(warehouse);
            log.error(`仓库 ${warehouse.id} 已因分拣回滚失败而停用: ${rollResult.error}`);
          }
        }
      } else {
        log.info(`槽 ${slot} 无法分类（${originalAmount} 个未变动）`);
      }

      // 无论结果如何，游标 +1（回绕），不阻塞
      model.inputSlotCursors.set(containerId, (slot + 1) % container.size);
    } catch (error) {
      log.error(`处理输入容器 ${containerId} 时出错: ${error}`);
      // 尝试回滚已记录的目标容器
      const rollResult = journal.rollback();
      if (rollResult.ok) {
        this.runtime.markDirty(warehouse.id);
        log.info(`回滚成功，已撤销本次分拣对目标容器的写入`);
      } else {
        warehouse.settings.enabled = false;
        this.repository.saveMetaOnly(warehouse);
        log.error(`仓库 ${warehouse.id} 已因回滚失败而停用: ${rollResult.error}`);
      }
    }
  }

  // ─── 目标选择与转移 ─────────────────────────────────────────────

  /**
   * 按优先级尝试将物品堆放入仓库中的目标容器。
   *
   * 优先级顺序：
   * 1. **大宗容器**（单物品）—— 高产量单品优先路由到专用大宗箱。
   * 2. **已有同类物品的普通容器**（多物品）—— 利用运行时索引加速。
   * 3. **同族物品的普通容器**（家庭同族）—— 同一家族聚集到同一容器。
   * 4. **空的普通容器**（自动创建分类）—— 当 `autoCreateCategories` 开启时启用。
   * 5. **杂项容器**（兜底）—— 任何物品最终都能放入杂项容器。
   *
   * 每一优先级都会调用 `tryContainers` 遍历候选容器列表并尝试放入。
   * 一旦整堆全部放完（返回 undefined），立即返回，不再尝试后续优先级。
   *
   * @param stack - 待放置的物品堆
   * @param warehouse - 仓库数据
   * @param model - 运行态模型（包含索引、容器分类列表等）
   * @param dimension - 物品所在的维度
   * @returns 未能放入的剩余物品堆，全部放完则返回 undefined
   */
  private moveStackIntoWarehouse(
    stack: ItemStack,
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    journal: MoveJournal
  ): ItemStack | undefined {
    const typeId = stack.typeId;
    let remaining: ItemStack | undefined = stack;

    // ── 优先级 1：单物品（大宗）────────────────────────────────
    // 大宗容器专收单一类型高产量物品，匹配规则：
    //   - 非空箱：匹配箱内已有物品种类
    //   - 空箱：不接收物品，玩家需手动放入第一件物品来设定种类
    //
    // 注意：大宗 > 普通。专用大宗箱应优先拦截高产量单品（如白色羊毛），
    // 避免被多物品普通箱截胡，剩余的散品再 fallthrough 给后续优先级处理。
    //
    // 设计笔记：大宗箱不走 itemTypeIndex 而是每次都全量扫描
    // `model.bulkContainerIds`。原因是 bulk 数量极少（典型场景 1-5），
    // 硬扫成本远低于索引维护（脏数据检测、惰性清除、回退扫描的复杂度）。
    // 索引在 normal 箱数量大（几十上百）时有巨大收益，在 bulk 箱上收益为负。
    const bulkMatches = model.bulkContainerIds.filter((id) => {
      const stored = warehouse.containers[id];
      if (!stored) return false;
      const target = getContainerFromStored(dimension, stored);
      if (!target) return false;
      if (isContainerEmpty(target)) return false; // 空箱需玩家手动放入第一件物品
      return getBulkChestFirstType(target) === typeId;
    });
    const bulkResult = this.selector.tryPlaceInBulkContainers(remaining, bulkMatches, warehouse, model, dimension, journal);
    remaining = bulkResult.remaining;
    if (remaining === undefined) return undefined;

    // ── 优先级 2：多物品（普通）────────────────────────────────
    // 利用运行时 itemTypeIndex 索引快速查找已有同类物品的普通容器。
    /** 前一级别剩余量，用于检测降级 */
    let prevAmount = remaining.amount;
    let normalCandidates = this.selector.findExistingTypeContainers(warehouse, model, typeId, dimension);
    let normalResult = this.selector.tryPlaceInContainers(remaining, normalCandidates, warehouse, model, dimension, journal, "match");

    // 索引自愈：index 有候选但全放不进 → 可能有玩家手动放置的新容器
    // 触发全量扫描发现后重试（若 findExistingTypeContainers 已做全扫则跳过）
    if (normalCandidates.length > 0 && normalResult.modifiedIds.size === 0 && normalResult.remaining) {
      const discovered = this.selector.findExistingTypeContainers(warehouse, model, typeId, dimension);
      const newCandidates = discovered.filter((id) => !normalCandidates.includes(id));
      if (newCandidates.length > 0) {
        normalCandidates = [...normalCandidates, ...newCandidates];
        const retryResult = this.selector.tryPlaceInContainers(
          normalResult.remaining,
          newCandidates,
          warehouse,
          model,
          dimension,
          journal,
          "match"
        );
        remaining = retryResult.remaining;
        for (const id of retryResult.modifiedIds) normalResult.modifiedIds.add(id);
      } else {
        remaining = normalResult.remaining;
      }
    } else {
      remaining = normalResult.remaining;
    }

    // 大宗降级/阈值互斥检测
    // remaining !== undefined → 全部放完，无溢出 → 检查阈值
    // remaining !== undefined && remaining.amount < prevAmount → 部分溢出 → 降级告警
    // remaining !== undefined && remaining.amount === prevAmount → 未放入 → 无操作
    const bulkOverflow =
      remaining !== undefined && remaining.amount > 0 && remaining.amount < prevAmount && bulkMatches.length > 0;
    if (bulkOverflow) {
      this.warnStorageFull(warehouse, typeId, "大宗", "普通");
    } else if (remaining === undefined) {
      this.checkGroupCapacity(warehouse, bulkMatches, typeId, "大宗", bulkResult.modifiedIds);
    }
    if (remaining === undefined) return undefined;
    prevAmount = remaining.amount;

    // ── 优先级 3：家庭同族 ──────────────────────────────────────
    const family = getFamily(typeId);
    const enabledFamilies = warehouse.settings.enabledFamilies ?? [];
    if (family && enabledFamilies.includes(family.id)) {
      const familyCandidates = this.selector.findExistingFamilyContainers(warehouse, model, family.id, dimension);
      const familyResult = this.selector.tryPlaceInContainers(remaining, familyCandidates, warehouse, model, dimension, journal, "family");
      remaining = familyResult.remaining;
      this.checkGroupCapacity(warehouse, familyCandidates, typeId, "同族", familyResult.modifiedIds);
      if (remaining === undefined) return undefined;
      // 同族与普通同级，不触发降级告警
      prevAmount = remaining.amount;
    }

    // ── 优先级 4：自动创建分类 ────────────────────────────────
    if (warehouse.settings.autoCreateCategories) {
      const freeNormal = this.selector.findEmptyNormalContainer(warehouse, model, dimension);
      if (freeNormal) {
        const autoResult = this.selector.tryPlaceInContainers(remaining, [freeNormal], warehouse, model, dimension, journal, "autocreate");
        remaining = autoResult.remaining;
        this.checkGroupCapacity(warehouse, [freeNormal], typeId, "自动分类", autoResult.modifiedIds);
        if (remaining === undefined) return undefined;
        prevAmount = remaining.amount;
      }
    }

    // ── 优先级 5：杂项（兜底）──────────────────────────────────
    const miscResult = this.selector.tryPlaceInContainers(remaining, model.miscContainerIds, warehouse, model, dimension, journal, "misc");
    remaining = miscResult.remaining;

    // 普通降级/阈值互斥检测
    // remaining === undefined → 全部放完，无溢出 → 检查阈值
    // remaining !== undefined && remaining.amount < prevAmount → 部分溢出 → 降级告警
    // remaining !== undefined && remaining.amount === prevAmount → 未放入 → 无操作
    const normalOverflow =
      remaining !== undefined && remaining.amount > 0 && remaining.amount < prevAmount && normalCandidates.length > 0;
    if (normalOverflow) {
      this.warnStorageFull(warehouse, typeId, "普通", "杂项");
    } else if (remaining === undefined) {
      this.checkGroupCapacity(warehouse, normalCandidates, typeId, "普通", normalResult.modifiedIds);
    }
    if (remaining === undefined) return undefined;

    // 全满 → 通知玩家手动处理
    if (remaining.amount > 0) {
      this.warnAllFull(warehouse, typeId);
    }

    // 杂项阈值（最底层，始终检查）
    this.checkGroupCapacity(warehouse, model.miscContainerIds, typeId, "杂项", miscResult.modifiedIds);

    return remaining;
  }



  // ─── 通知方法（冷却管理 + 玩家消息）─────────────────────────

  private checkGroupCapacity(
    warehouse: WarehouseData,
    candidates: ContainerId[],
    typeId: string,
    levelLabel: string,
    modifiedIds: Set<ContainerId>
  ): void {
    if (!warehouse.settings.capacityWarning) return;
    if (candidates.length === 0) return;

    const key = `group:${warehouse.id}:${levelLabel}:${typeId}`;
    const last = this.warningCooldowns.get(key) ?? 0;
    const cooldownActive = system.currentTick - last < 100;

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

    if (totalSlots === 0 || totalUsed / totalSlots < 0.6) return;
    if (cooldownActive) return;

    this.warningCooldowns.set(key, system.currentTick);
    const list = details.length > 0
      ? details.map((c, i) => `#${i + 1}-${c.id}(${c.pct}%)`).join(" ")
      : "（无）";
    const pct = Math.round((totalUsed / totalSlots) * 100);
    this.sendWarnToNearby(warehouse, `仓库 ${warehouse.displayName} 类型:${levelLabel} 物品:${typeId} 组容量:${pct}% 容器:${list} 已达阈值`);
  }

  private warnStorageFull(warehouse: WarehouseData, typeId: string, fromLevel: string, toLevel: string): void {
    const key = `full:${warehouse.id}:${fromLevel}->${toLevel}`;
    const last = this.warningCooldowns.get(key) ?? 0;
    if (system.currentTick - last < 100) return;
    this.warningCooldowns.set(key, system.currentTick);
    this.sendWarnToNearby(warehouse, `§c${typeId} ${fromLevel}容器组已满，降级至${toLevel}`);
  }

  private warnAllFull(warehouse: WarehouseData, typeId: string): void {
    const key = `allfull:${warehouse.id}`;
    const last = this.warningCooldowns.get(key) ?? 0;
    if (system.currentTick - last < 300) return;
    this.warningCooldowns.set(key, system.currentTick);
    this.sendWarnToNearby(warehouse, `§c${typeId} 无法分类！所有容器已满`);
  }

  private sendWarnToNearby(warehouse: WarehouseData, message: string): void {
    try {
      for (const p of world.getPlayers()) {
        if (p.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: p.location.x, z: p.location.z }, warehouse.area, 8)) {
          try { p.sendMessage(`§c[仓库]§r ${message}`); } catch { }
        }
      }
    } catch { }
  }

  private sendInfoToNearby(warehouse: WarehouseData, message: string): void {
    try {
      for (const p of world.getPlayers()) {
        if (p.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: p.location.x, z: p.location.z }, warehouse.area, 8)) {
          try { p.sendMessage(`§a[仓库]§r ${message}`); } catch { }
        }
      }
    } catch { }
  }

  private trySetIdle(warehouse: WarehouseData, model: WarehouseRuntimeModel): void {
    if (model.idle) return;
    const dim = this.getDimensionSafe(warehouse.dimensionId);
    if (!dim) return;
    for (const cid of model.inputContainerIds) {
      const stored = warehouse.containers[cid];
      if (!stored) continue;
      const c = getContainerFromStored(dim, stored);
      if (c && c.emptySlotsCount < c.size) return;
    }
    model.idle = true;
    log.info(`仓库 ${warehouse.id} 分拣完成`);
    this.sendInfoToNearby(warehouse, "§a仓库分拣完成");
  }


  // ─── 工具方法 ──────────────────────────────────────────────────

  private getDimensionSafe(dimensionId: string): Dimension | undefined {
    try {
      return world.getDimension(dimensionId);
    } catch {
      return undefined;
    }
  }
}
