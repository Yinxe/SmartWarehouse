import { Container, Dimension, ItemStack, system, world } from "@minecraft/server";
import { getFamily, getFamilyById } from "../../data/ItemFamilies";
import { WarehouseRuntimeRegistry } from "../cache/WarehouseRuntimeRegistry";
import { WarehouseRepository } from "../persistence/WarehouseRepository";
import type { ContainerId, WarehouseData, WarehouseId, WarehouseRuntimeModel } from "../../types";
import { getOrComputeContainerStats, refreshContainerStats } from "../WarehouseStatsService";
import { Logger } from "../Logger";
import { isNearAreaXZ } from "../../domain/shared/Vector";
import {
    containerHasType,
    getBulkChestFirstType,
    getContainerFromStored,
    getFamilyPurity,
    isContainerEmpty,
    tryMoveStackIntoContainer,
    tryMoveStackIntoContainerWithJournal
} from "./container/ContainerAccess";
import { MoveJournal } from "./container/MoveJournal";
import { SlotOrganizer } from "./container/SlotOrganizer";
import { playSortEffect } from "./SortEffects";
import { sortByPurityDescending, type ScoredContainer } from "../../domain/sorting/PurityRanking";
import {
  computeGroupCapacity,
  isCooldownElapsed,
  shouldTriggerOverflowWarning,
  SORTING_WARNING_COOLDOWN_TICKS,
  ALL_FULL_COOLDOWN_TICKS,
} from "../../domain/sorting/CapacityWarning";

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

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly runtime: WarehouseRuntimeRegistry,
    private readonly organizer?: SlotOrganizer
  ) {}

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
        const nextSlot = this.findNextNonEmptySlot(container, slot);
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
    const bulkResult = this.tryBulkContainers(remaining, bulkMatches, warehouse, model, dimension, typeId, journal);
    remaining = bulkResult.remaining;
    if (remaining === undefined) return undefined;

    // ── 优先级 2：多物品（普通）────────────────────────────────
    // 利用运行时 itemTypeIndex 索引快速查找已有同类物品的普通容器。
    /** 前一级别剩余量，用于检测降级 */
    let prevAmount = remaining.amount;
    let normalCandidates = this.findExistingTypeContainers(warehouse, model, typeId, dimension);
    let normalResult = this.tryContainers(remaining, normalCandidates, warehouse, model, dimension, typeId, journal, "match");

    // 索引自愈：index 有候选但全放不进 → 可能有玩家手动放置的新容器
    // 触发全量扫描发现后重试（若 findExistingTypeContainers 已做全扫则跳过）
    if (normalCandidates.length > 0 && normalResult.modifiedIds.size === 0 && normalResult.remaining) {
      const discovered: ContainerId[] = [];
      this.fullScanNormalContainers(warehouse, model, typeId, dimension, discovered);
      const newCandidates = discovered.filter((id) => !normalCandidates.includes(id));
      if (newCandidates.length > 0) {
        normalCandidates = [...normalCandidates, ...newCandidates];
        const retryResult = this.tryContainers(
          normalResult.remaining,
          newCandidates,
          warehouse,
          model,
          dimension,
          typeId,
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
      const familyCandidates = this.findExistingFamilyContainers(warehouse, model, family.id, dimension);
      const familyResult = this.tryContainers(remaining, familyCandidates, warehouse, model, dimension, typeId, journal, "family");
      remaining = familyResult.remaining;
      this.checkGroupCapacity(warehouse, familyCandidates, typeId, "同族", familyResult.modifiedIds);
      if (remaining === undefined) return undefined;
      // 同族与普通同级，不触发降级告警
      prevAmount = remaining.amount;
    }

    // ── 优先级 4：自动创建分类 ────────────────────────────────
    if (warehouse.settings.autoCreateCategories) {
      const freeNormal = this.findEmptyNormalContainer(warehouse, model, dimension);
      if (freeNormal) {
        const autoResult = this.tryContainers(remaining, [freeNormal], warehouse, model, dimension, typeId, journal, "autocreate");
        remaining = autoResult.remaining;
        this.checkGroupCapacity(warehouse, [freeNormal], typeId, "自动分类", autoResult.modifiedIds);
        if (remaining === undefined) return undefined;
        prevAmount = remaining.amount;
      }
    }

    // ── 优先级 5：杂项（兜底）──────────────────────────────────
    const miscResult = this.tryContainers(remaining, model.miscContainerIds, warehouse, model, dimension, typeId, journal, "misc");
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

  /**
   * 遍历候选容器列表，尝试将剩余物品堆放入每个容器。
   *
   * 对每个容器：
   * - 获取其 `StoredContainer` 信息，跳过数据缺失的容器。
   * - 通过 `getContainerFromStored` 获取方块容器对象，若不可达则跳过并记录日志。
   * - 调用 `tryMoveStackIntoContainer` 尝试将物品放入容器。
   * - 若有物品成功放入（`placed > 0`），则将容器 ID 更新到 `itemTypeIndex` 索引中，
   *   以便未来同类物品的分拣能快速定位到该容器。
   * - 如果剩余物品全部放完（`remaining === undefined`），提前终止遍历。
   *
   * @param stack - 当前待放置的物品堆（undefined 表示已放完）
   * @param containerIds - 候选容器 ID 列表
   * @param warehouse - 仓库数据
   * @param model - 运行态模型
   * @param dimension - 维度
   * @param typeId - 物品类型 ID
   * @param tag - 日志标签，用于区分不同优先级（match / autocreate / misc）
   * @returns 剩余物品堆 + 本次被修改的容器 ID 集合
   */
  private tryContainers(
    stack: ItemStack | undefined,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    typeId: string,
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
        // 家族分拣日志追加容器纯度，方便调试验证纯度排序效果
        let purityLog = "";
        if (tag === "family") {
          const purFamily = getFamily(typeId);
          if (purFamily) {
            const purity = getFamilyPurity(targetContainer!, new Set(purFamily.items));
            purityLog = ` (纯度${(purity * 100).toFixed(0)}%)`;
          }
        }
        log.info(
          `[${tag ?? "?"}]${purityLog} ${typeId} x${placed} → ${containerId} (角色=${stored.role}) @ (${loc.x},${loc.y},${loc.z})`
        );
        // 记录索引，下回同类物品快速定位到此容器
        this.addToTypeIndex(model, typeId, containerId);
        // 如果物品属于某个启用的同族分类，同步更新 familyTypeIndex
        const placedFamily = getFamily(typeId);
        if (placedFamily && (warehouse.settings.enabledFamilies ?? []).includes(placedFamily.id)) {
          this.addToFamilyIndex(model, placedFamily.id, containerId);
        }
        // 播放分拣动画（粒子 + 音效）
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        // 触发目标容器的混乱度检查，必要时自动整理
        this.organizer?.onDeposit(targetContainer, containerId, warehouse.settings.autoSortThreshold / 100);
      }
      // 注：同类型容器间溢出（同一级别内）属正常扩容行为，不告警
      // 容器组级容量预警在 moveStackIntoWarehouse 的 checkGroupCapacity 中处理

      if (remaining === undefined) return { remaining: undefined, modifiedIds }; // 全部放完，提前退出
    }

    return { remaining, modifiedIds };
  }

  /**
   * 尝试将物品放入大宗容器中。
   *
   * 大宗容器的插入逻辑与普通容器不同：
   * 1. **优先填满箱内已有的潜影盒** —— 遍历容器槽位，对每个潜影盒调用
   *    `tryFillShulkerBoxes`，将物品放入盒内。
   * 2. **再填充空槽位** —— 调用 `tryMoveStackIntoContainer` 放入散装空间。
   *
   * 此类容器专用于单一物品类型，混合存储潜影盒与散装物品。
   *
   * 设计笔记：本方法不走 `itemTypeIndex` 也不向索引写入。原因是：
   * - `findExistingTypeContainers` 在 :508 行以 `role !== "normal"` 过滤了 bulk。
   * - bulk 容器数量极少（~1-5），每次全量扫描的成本远低于索引自愈的复杂度。
   * - 索引是 normal 箱在数量大时的优化手段，对 bulk 箱收益为负。
   *
   * @param stack - 当前待放置的物品堆
   * @param containerIds - 候选大宗容器 ID 列表
   * @param warehouse - 仓库数据
   * @param model - 运行态模型
   * @param dimension - 维度
   * @param typeId - 物品类型 ID
   * @returns 剩余物品堆 + 本次被修改的容器 ID 集合
   */
  private tryBulkContainers(
    stack: ItemStack | undefined,
    containerIds: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    dimension: Dimension,
    typeId: string,
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

      // 在写入前记录目标容器快照
      journal.snapshotTarget(containerId, target);

      // 第 1 步：优先填入箱内已有的潜影盒 (系统API不支持,或许未来支持)
      // remaining = tryFillShulkerBoxes(target, remaining);
      // if (remaining === undefined) {
      //   playSortEffect(dimension, stored.occupiedLocations, stored.role);
      //   this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
      //   return { remaining: undefined, modifiedIds };
      // }

      // 第 2 步：剩余物品填入空槽位（散装）
      remaining = tryMoveStackIntoContainer(remaining, target);

      const placed = beforeAmount - (remaining?.amount ?? 0);
      if (placed > 0) {
        modifiedIds.add(containerId);
        log.info(`[bulk] ${typeId} x${placed} → ${containerId} @ (${loc.x},${loc.y},${loc.z})`);
        playSortEffect(dimension, stored.occupiedLocations, stored.role);
        this.organizer?.onDeposit(target, containerId, warehouse.settings.autoSortThreshold / 100);
      }

      if (remaining === undefined) return { remaining: undefined, modifiedIds };
    }

    return { remaining, modifiedIds };
  }

  // ─── 容量预警 ──────────────────────────────────────────────────

  /**
   * 检查候选容器组的总容量是否达到阈值。
   *
   * 计算组级容量：总已用槽位 / 总槽位 >= 阈值时触发预警。
   * 仅对本次分拣中被修改的容器执行全量刷新（扫描 + 持久化），
   * 其余容器从缓存读取（内存 → DP → 懒计算）。
   *
   * @param warehouse   仓库数据
   * @param candidates  候选容器 ID 列表
   * @param typeId      物品类型 ID
   * @param levelLabel  级别标签（大宗 / 普通 / 同族 / 杂项）
   * @param modifiedIds 本次分拣中被修改的容器 ID 集合
   */
  private checkGroupCapacity(
    warehouse: WarehouseData,
    candidates: ContainerId[],
    typeId: string,
    levelLabel: string,
    modifiedIds: Set<ContainerId>
  ): void {
    if (!warehouse.settings.capacityWarning) return;
    if (candidates.length === 0) return;

    // 冷却检查：仅控制预警消息频率，不影响统计数据刷新
    const key = `group:${warehouse.id}:${levelLabel}:${typeId}`;
    const last = this.warningCooldowns.get(key) ?? 0;
    const cooldownActive = system.currentTick - last < SORTING_WARNING_COOLDOWN_TICKS;

    // 计算组级容量：遍历所有候选容器，汇总总已用/总槽位
    let totalUsed = 0;
    let totalSlots = 0;
    const containerDetails: { id: string; pct: number }[] = [];

    for (const cid of candidates) {
      const stored = warehouse.containers[cid];
      if (!stored) continue;

      // 只对本次被修改的容器执行全量刷新，其余从缓存读取
      const stats = modifiedIds.has(cid)
        ? refreshContainerStats(warehouse, stored)
        : getOrComputeContainerStats(warehouse, stored);

      if (!stats) continue;

      totalUsed += stats.usedSlots;
      totalSlots += stats.totalSlots;

      // 记录容量超阈值的容器详情（用于预警消息）
      if (stats.isWarning) {
        const pct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
        containerDetails.push({ id: cid.slice(-8), pct });
      }
    }

    // 组级容量未达阈值 → 不预警
    const capacity = computeGroupCapacity(totalUsed, totalSlots);
    if (!capacity.isWarning) return;

    // 冷却中 → 跳过消息发送（统计数据已刷新，只是不发消息）
    if (cooldownActive) return;

    this.warningCooldowns.set(key, system.currentTick);

    const containerList = containerDetails.length > 0
      ? containerDetails.map((c, i) => `#${i + 1}-${c.id}(${c.pct}%)`).join(" ")
      : "（无单容器超阈值，但组总容量已满）";
    const groupPct = Math.round((totalUsed / totalSlots) * 100);
    this.sendWarnToNearby(
      warehouse,
      `§e仓库 ${warehouse.displayName} 类型:${levelLabel} 物品:${typeId} 组容量:${groupPct}% 容器: ${containerList} 总容量已达阈值`
    );
  }

  /**
   * 降级预警：匹配的容器组已达到容量上限，物品溢出到低优先级容器。
   * 提示玩家整理或扩容。
   */
  private warnStorageFull(warehouse: WarehouseData, typeId: string, fromLevel: string, toLevel: string): void {
    const key = `full:${warehouse.id}:${fromLevel}->${toLevel}`;
    const last = this.warningCooldowns.get(key) ?? 0;
    if (!isCooldownElapsed(last, system.currentTick, SORTING_WARNING_COOLDOWN_TICKS)) return;
    this.warningCooldowns.set(key, system.currentTick);

    this.sendWarnToNearby(warehouse, `§c${typeId} ${fromLevel}容器组已满，降级至${toLevel}，请整理或扩容`);
  }

  /**
   * 全满预警：所有容器都放不下了，物品滞留在输入容器。
   */
  private warnAllFull(warehouse: WarehouseData, typeId: string): void {
    const key = `allfull:${warehouse.id}`;
    const last = this.warningCooldowns.get(key) ?? 0;
    if (!isCooldownElapsed(last, system.currentTick, ALL_FULL_COOLDOWN_TICKS)) return;
    this.warningCooldowns.set(key, system.currentTick);

    this.sendWarnToNearby(warehouse, `§c${typeId} 无法分类！所有容器已满，请手动整理杂项容器或扩容`);
  }

  /** 向仓库附近玩家发送预警消息（红色前缀）。 */
  private sendWarnToNearby(warehouse: WarehouseData, message: string): void {
    try {
      for (const player of world.getPlayers()) {
        if (player.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: player.location.x, z: player.location.z }, warehouse.area, 8)) {
          try { player.sendMessage(`§c[仓库]§r ${message}`); } catch { /* 忽略 */ }
        }
      }
    } catch { /* 忽略 */ }
  }

  /** 向仓库附近玩家发送信息消息（绿色前缀）。 */
  private sendInfoToNearby(warehouse: WarehouseData, message: string): void {
    try {
      for (const player of world.getPlayers()) {
        if (player.dimension.id !== warehouse.dimensionId) continue;
        if (isNearAreaXZ({ x: player.location.x, z: player.location.z }, warehouse.area, 8)) {
          try { player.sendMessage(`§a[仓库]§r ${message}`); } catch { /* 忽略 */ }
        }
      }
    } catch { /* 忽略 */ }
  }

  /**
   * 检查并标记仓库为空闲状态。
   *
   * 扫描所有输入容器，若全部为空则设置 idle = true 并通知附近玩家。
   * 仅当模型当前非空闲时执行。
   */
  private trySetIdle(warehouse: WarehouseData, model: WarehouseRuntimeModel): void {
    if (model.idle) return;
    const dimension = this.getDimensionSafe(warehouse.dimensionId);
    if (!dimension) return;

    for (const cid of model.inputContainerIds) {
      const stored = warehouse.containers[cid];
      if (!stored) continue;
      const container = getContainerFromStored(dimension, stored);
      if (container && container.emptySlotsCount < container.size) {
        return; // 仍有物品，不空闲
      }
    }

    model.idle = true;
    log.info(`仓库 ${warehouse.id} 分拣完成`);
    this.sendInfoToNearby(warehouse, "§a仓库分拣完成");
  }

  // ─── itemTypeIndex 索引辅助方法 ────────────────────────────────

  /**
   * 查找当前仓库中已包含指定物品类型的普通容器。
   *
   * **核心设计 —— 索引自愈机制（Index Self-Healing）：**
   *
   * 为了提高分拣效率，运行态维护了一个 `itemTypeIndex` 字典，
   * 键为物品类型 ID，值为包含该物品的普通容器 ID 列表。
   *
   * 但由于容器内的物品可能被玩家取走、容器被破坏或替换，
   * 索引可能变得"脏"（stale）。本方法采用**惰性校验 + 自动修复**策略：
   *
   * ┌─ 快速路径（有索引记录）─────────────────────────────────────┐
   * │ 1. 从 `itemTypeIndex` 取出候选容器列表。                       │
   * │ 2. 对每个候选容器校验：                                      │
   * │    - 容器数据仍存在且角色仍为 "normal" → 继续。              │
   * │    - 容器方块可访问且确实包含该类型 → 加入有效列表。         │
   * │    - 容器方块可访问但不包含该类型 → 标记为脏数据。           │
   * │    - 容器方块不可达（区块未加载）→ 保留在索引但本次跳过。    │
   * │ 3. 若有脏数据，从索引中清除，若某类型下所有容器都被清空      │
   * │    则删除该索引条目。                                        │
   * └──────────────────────────────────────────────────────────────┘
   *
   * ┌─ 回退路径（无索引记录）─────────────────────────────────────┐
   * │ 1. 全量扫描 `model.normalContainerIds` 中的所有容器。        │
   * │ 2. 找出实际包含该物品类型的容器。                            │
   * │ 3. 将结果写回 `itemTypeIndex`，后续同类物品走快速路径。      │
   * └──────────────────────────────────────────────────────────────┘
   *
   * 这种设计的好处：
   * - 索引无需在物品变化时实时同步，避免了复杂的事件监听。
   * - 脏数据最多影响一次查询性能（这次多校验几个无效容器），不会导致错误。
   * - 全量扫描的结果会被"学习"到索引中，后续分拣越来越快。
   *
   * @param warehouse - 仓库数据
   * @param model - 运行态模型（含 itemTypeIndex）
   * @param typeId - 物品类型 ID
   * @param dimension - 维度
   * @returns 当前实际包含该物品类型的普通容器 ID 列表
   */
  private findExistingTypeContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    typeId: string,
    dimension: Dimension
  ): ContainerId[] {
    const hasIndexEntry = model.itemTypeIndex.has(typeId);

    // ── 阶段 1：校验候选容器 ─────────────────────────────────
    // 有索引时走快速路径（候选集小），无索引时全量扫描所有 normal 容器
    const { valid, stale } = this.validateIndexCandidates(
      hasIndexEntry,
      hasIndexEntry ? model.itemTypeIndex.get(typeId)! : model.normalContainerIds,
      warehouse,
      model,
      typeId,
      dimension
    );

    // ── 阶段 2：惰性清除脏索引 ───────────────────────────────
    if (hasIndexEntry && stale.size > 0) {
      this.cleanStaleIndexEntries(model, typeId, stale);
    }

    // ── 阶段 3：索引全脏后的零延迟回退 ────────────────────────
    // 场景：玩家把圆石从 normal 箱 A 移到 normal 箱 B。
    //       索引指向 A（{"cobblestone":["A"]}），但 A 已无圆石。
    //       阶段 1 会清空索引条目，valid 为空。
    //       此时物品会错误地落入杂项箱。
    // 修复：立即全量扫描，零回合延迟。
    if (hasIndexEntry && stale.size > 0 && valid.length === 0) {
      this.fullScanNormalContainers(warehouse, model, typeId, dimension, valid);
    }

    // ── 阶段 4：学习新发现的容器到索引 ───────────────────────
    // 回退路径下的扫描结果写入索引，下次同类物品走快速路径
    if (!hasIndexEntry && valid.length > 0) {
      model.itemTypeIndex.set(typeId, [...valid]);
    }

    return valid;
  }

  /**
   * 校验候选容器列表中哪些仍然有效，哪些已过时。
   *
   * @param hasIndexEntry - 是否有索引记录（决定脏标记行为）
   * @param candidates    - 候选容器 ID 列表
   * @returns 有效列表和脏数据集合
   */
  private validateIndexCandidates(
    hasIndexEntry: boolean,
    candidates: ContainerId[],
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
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
        // 容器不可达（区块未加载）→ 索引路径下保留在索引但本次跳过，
        // 避免因暂时不可达而错误清理索引
        if (hasIndexEntry) valid.push(containerId);
        continue;
      }

      // 空箱短路：容器全空则不可能包含目标物品，无需逐槽扫描
      if (isContainerEmpty(container)) {
        if (hasIndexEntry) stale.add(containerId);
        continue;
      }

      if (containerHasType(container, typeId)) {
        valid.push(containerId);
      } else if (hasIndexEntry) {
        stale.add(containerId);
      }
      // 回退路径（无索引）的候选即使不匹配也不标记脏
      // 因为它们本来就不在索引中
    }

    return { valid, stale };
  }

  /**
   * 从索引中惰性清除脏条目。
   * 如果某类型下所有容器都脏了，删除整个条目。
   */
  private cleanStaleIndexEntries(model: WarehouseRuntimeModel, typeId: string, stale: Set<ContainerId>): void {
    const candidates = model.itemTypeIndex.get(typeId);
    if (!candidates) return;

    const updated = candidates.filter((id) => !stale.has(id));
    if (updated.length > 0) {
      model.itemTypeIndex.set(typeId, updated);
    } else {
      model.itemTypeIndex.delete(typeId);
    }
  }

  /**
   * 全量扫描所有 normal 容器，查找包含指定物品类型的容器。
   * 跳过已在 candidates 中检查过的容器。
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
      // 空箱短路：容器全空则不可能包含目标物品
      if (isContainerEmpty(container)) continue;
      if (containerHasType(container, typeId)) {
        result.push(containerId);
      }
    }

    // 将新发现的结果写回索引，下次走快速路径
    if (result.length > 0) {
      model.itemTypeIndex.set(typeId, [...result]);
    }
  }

  /**
   * 查找已包含指定同族物品的普通容器。
   *
   * 当物品属于某个已启用的同族分类时，根据 `familyTypeIndex` 查找已有同类族物品的容器，
   * 使得同族物品（如各色羊毛）能够自动聚集到同一容器中。
   *
   * @param warehouse - 仓库数据
   * @param model     - 运行态模型
   * @param familyId  - 同族分类 ID
   * @param dimension - 维度
   * @returns 候选容器 ID 列表
   */
  private findExistingFamilyContainers(
    warehouse: WarehouseData,
    model: WarehouseRuntimeModel,
    familyId: string,
    dimension: Dimension
  ): ContainerId[] {
    const family = getFamilyById(familyId);
    if (!family) return [];

    // 预计算成员 Set，在验证和纯度计算中复用
    const memberSet = new Set(family.items);

    const candidates = model.familyTypeIndex.get(familyId);
    const hasIndex = candidates !== undefined && candidates.length > 0;

    const valid: ContainerId[] = [];
    const stale = new Set<ContainerId>();
    // 缓存已验证通过的容器引用，避免 purity 排序时重复 getContainerFromStored
    const containerCache = new Map<ContainerId, Container>();

    // ── 有索引：检查索引项，标记过期 ──────────────
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

      // 惰性清除脏索引
      if (stale.size > 0) {
        const updated = candidates.filter((id) => !stale.has(id));
        if (updated.length > 0) {
          model.familyTypeIndex.set(familyId, updated);
        } else {
          model.familyTypeIndex.delete(familyId);
        }
      }
    }

    // ── 回退 / 初始全量扫描 ─────────────────────────
    // 场景 A（初始）：索引为空，手工放入的家族物品从未被分拣引擎发现
    // 场景 B（回退）：索引被清空后，全量扫描重建
    const needsFullScan = !hasIndex || (valid.length === 0 && stale.size > 0);
    if (!needsFullScan) {
      return this.sortByFamilyPurity(valid, memberSet, containerCache);
    }

    for (const containerId of model.normalContainerIds) {
      // 跳过已检查过的容器
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

    // 将扫描结果写回索引，下次走快速路径
    if (valid.length > 0) {
      model.familyTypeIndex.set(familyId, [...valid]);
    }

    return this.sortByFamilyPurity(valid, memberSet, containerCache);
  }

  /**
   * 将容器 ID 记录到运行时同族分类索引中。
   *
   * @param model       - 运行态模型
   * @param familyId    - 同族分类 ID
   * @param containerId - 容器 ID
   */
  private addToFamilyIndex(model: WarehouseRuntimeModel, familyId: string, containerId: ContainerId): void {
    const existing = model.familyTypeIndex.get(familyId);
    if (existing) {
      if (!existing.includes(containerId)) {
        existing.push(containerId);
      }
    } else {
      model.familyTypeIndex.set(familyId, [containerId]);
    }
  }

  /**
   * 按家族纯度对候选容器列表降序排序。
   *
   * 纯度越高的容器越优先接收物品，使得家族物品自然流入更"专一"的容器，
   * 避免已混杂多个家族的容器承受过大的物品压力。
   *
   * @param containerIds  - 候选容器 ID 列表
   * @param memberSet     - 目标家族物品 typeId 集合（预计算，O(1) 成员检测）
   * @param containerCache - 验证阶段已获取的容器引用缓存
   * @returns 按纯度降序排序后的容器 ID 列表
   */
  private sortByFamilyPurity(
    containerIds: ContainerId[],
    memberSet: Set<string>,
    containerCache: Map<ContainerId, Container>
  ): ContainerId[] {
    // 将容器引用缓存转换为 ScoredContainer（纯度仍需从 Minecraft Container 读取）
    const scored: ScoredContainer[] = [];
    for (let i = 0; i < containerIds.length; i++) {
      const containerId = containerIds[i];
      const container = containerCache.get(containerId);
      const purity = container ? getFamilyPurity(container, memberSet) : 0;
      scored.push({ id: containerId, purity, originalIndex: i });
    }
    return sortByPurityDescending(scored);
  }

  /**
   * 将容器 ID 记录到运行时物品类型索引中，避免重复添加。
   *
   * 在 `tryContainers` 中每当有物品成功放入某个容器时调用，
   * 以便后续同类物品的分拣能通过索引快速定位到该容器。
   *
   * @param model - 运行态模型
   * @param typeId - 物品类型 ID
   * @param containerId - 容器 ID
   */
  private addToTypeIndex(model: WarehouseRuntimeModel, typeId: string, containerId: ContainerId): void {
    const existing = model.itemTypeIndex.get(typeId);
    if (existing) {
      if (!existing.includes(containerId)) {
        existing.push(containerId);
      }
    } else {
      model.itemTypeIndex.set(typeId, [containerId]);
    }
  }

  // ─── 工具方法 ──────────────────────────────────────────────────

  /**
   * 查找一个空的 normal 容器，用于自动创建新分类。
   *
   * 遍历 normal 容器列表，返回第一个完全空的容器 ID。
   * 如果所有 normal 容器都已有物品，则放弃自动创建（本次走杂项）。
   */
  private findEmptyNormalContainer(
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

  /**
   * 安全获取维度对象，避免因维度 ID 无效而抛出异常。
   *
   * @param dimensionId - 维度 ID（如 "overworld"、"nether"、"the_end"）
   * @returns 维度对象，获取失败时返回 undefined
   */
  /**
   * 从指定槽位开始查找下一个非空槽位。
   * 绕回遍历所有槽位，如果全空则返回 0（没找到也无妨，下次还会触发空槽检测）。
   */
  private findNextNonEmptySlot(container: import("@minecraft/server").Container, startSlot: number): number {
    for (let i = 1; i < container.size; i++) {
      const checkSlot = (startSlot + i) % container.size;
      const item = container.getItem(checkSlot);
      if (item) return checkSlot;
    }
    return (startSlot + 1) % container.size; // 全空，简单前进
  }

  private getDimensionSafe(dimensionId: string): Dimension | undefined {
    try {
      return world.getDimension(dimensionId);
    } catch {
      return undefined;
    }
  }
}
