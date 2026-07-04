/**
 * ============================================================================
 * SortingScheduler —— 低开销分拣调度器
 * ============================================================================
 *
 * 设计目标：将分拣负载分摊到多个 tick，避免集中冲击，最小化对服务器性能的影响。
 *
 * ### 核心设计
 *
 * 1. **单主循环**：一个 system.runInterval 管理所有仓库，而非每个仓库一个。
 * 2. **tick 预算**：每 tick 最多处理 1 个仓库的 1 个物品槽，负载稳定可预测。
 * 3. **轮询调度**：活跃仓库按顺序循环处理，公平分配 ticks。
 * 4. **效果节流**：粒子和音效每 tick 最多触发一次，避免视觉/音频重叠。
 * 5. **区块感知**：区块未加载时自动停用仓库，避免空转。
 * 6. **惰性生命周期**：玩家离开后延迟停用，释放内存和 tick 资源。
 *
 * ### 与其他插件/机器的兼容性
 *
 * - 单 tick 内最多执行 1 次 Container.getItem + 最多 1 次 Container.addItem
 * - 不持有跨 tick 锁，不影响其他插件的 tick 时间
 * - DP 写入在分拣 tick 内同步完成（小服单次写入 < 1ms）
 *
 * ### 性能指标估算（5-15人小服）
 *
 * - 仓库数量: 5-20 个
 * - 同时活跃: 2-5 个（玩家附近）
 * - 每 tick 处理: 1 个槽位
 * - 每 tick 耗时: ~0.5-2ms（远低于 50ms 的 tick 预算）
 * ============================================================================
 */

import { world, system } from "@minecraft/server";
import type { WarehouseArea, WarehouseId } from "../../../types";
import { WarehouseRepository } from "../../persistence/WarehouseRepository";
import { SorterEngine } from "../SorterEngine";
import { Logger } from "../../Logger";
import { isNearAreaXZ } from "../../../domain/shared/Vector";

const log = new Logger("SortingScheduler");

// ============================================================================
// 常量
// ============================================================================

/** 主循环间隔（4 tick ≈ 5 次/秒，分摊到不同 tick 中） */
const MASTER_INTERVAL = 4;

/** 仓库区域外扩格数，范围内有玩家才激活仓库 */
const PROXIMITY_MARGIN = 8;

/** 玩家离开后停用仓库的延迟 tick（60 tick ≈ 3 秒） */
const DEACTIVATE_DELAY = 60;

/** 区块加载检查间隔 tick（100 tick ≈ 5 秒） */
const AREA_CHECK_INTERVAL = 100;

/** 每 tick 最多处理的仓库数（预算控制，永远为 1 保证 tick 平稳） */
const BUDGET_PER_TICK = 1;

// ============================================================================
// 调度器
// ============================================================================

export class SortingScheduler {
  // ── 依赖注入 ──

  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine
  ) {}

  // ── 状态 ──

  /** 主循环的 system.runInterval 句柄 */
  private masterHandle: number | undefined;

  /** 活跃仓库 ID 列表（按轮询顺序） */
  private readonly active: WarehouseId[] = [];

  /** 轮询游标（下一次处理的仓库索引） */
  private cursor = 0;

  /** 仓库 ID → 最近有玩家 nearby 的 tick */
  private readonly lastActiveTick = new Map<WarehouseId, number>();

  /** 仓库 ID → 最近一次检查区块加载的 tick */
  private readonly lastAreaCheck = new Map<WarehouseId, number>();

  /** 仓库 ID → 区块加载状态缓存（true=已加载, false=未加载, undefined=未检查） */
  private readonly areaLoadedCache = new Map<WarehouseId, boolean>();

  /** 玩家位置缓存（维度 → [{x, z}]），每 tick 刷新 */
  private playerCache = new Map<string, { x: number; z: number }[]>();

  /** 上 tick 是否有粒子效果播出（节流用） */
  private effectPlayedThisTick = false;

  /** 仓库的最后在场玩家 ID（停用时通知用） */
  private readonly lastVisitor = new Map<WarehouseId, string>();

  // ─── 公开 API ──────────────────────────────────────────────

  /** 当前活跃（正在被调度）的仓库数量 */
  get activeCount(): number {
    return this.active.length;
  }

  /**
   * 启动调度器。
   * 幂等——重复调用安全。
   */
  start(): void {
    this.stop();
    this.masterHandle = system.runInterval(() => this.tick(), MASTER_INTERVAL);
    log.info("调度器已启动（主循环间隔=4 tick）");
  }

  /**
   * 停止调度器，停用所有仓库。
   * 幂等。
   */
  stop(): void {
    this.stopAll();
    if (this.masterHandle !== undefined) {
      system.clearRun(this.masterHandle);
      this.masterHandle = undefined;
    }
    this.cursor = 0;
    this.active.length = 0;
    this.lastActiveTick.clear();
    this.lastAreaCheck.clear();
    this.areaLoadedCache.clear();
    log.info("调度器已停止");
  }

  /**
   * 刷新单个仓库的调度状态。
   * 在仓库启用/禁用/速度变化/删除时由外部调用。
   */
  refreshOne(id: WarehouseId): void {
    const warehouse = this.repository.load(id);
    if (!warehouse || !warehouse.settings.enabled) {
      this.deactivate(id);
      return;
    }
    // 如果仓库已在活跃列表，重置游标确保以新配置运行
    // lifecycleTick 会自然重新激活
  }

  // ─── 主循环 ────────────────────────────────────────────────

  /**
   * 主循环 tick——每 MASTER_INTERVAL tick 执行一次。
   *
   * 执行顺序（确保负载可预测）：
   * 1. 刷新玩家位置缓存（O(playerCount)）
   * 2. 生命周期管理：激活/停用仓库（O(warehouseCount)）
   * 3. 按预算处理仓库（O(BUDGET_PER_TICK)）
   */
  private tick(): void {
    this.effectPlayedThisTick = false;
    this.refreshPlayerCache();
    this.manageLifecycle();
    this.processWithBudget();
  }

  // ─── 玩家位置缓存 ──────────────────────────────────────────

  /**
   * 刷新所有在线玩家的位置缓存。
   * 缓存仅在当前 tick 内有效，每 tick 重建一次。
   */
  private refreshPlayerCache(): void {
    this.playerCache.clear();
    for (const player of world.getPlayers()) {
      const dim = player.dimension.id;
      let list = this.playerCache.get(dim);
      if (!list) {
        list = [];
        this.playerCache.set(dim, list);
      }
      list.push({ x: player.location.x, z: player.location.z });
    }
  }

  // ─── 生命周期管理 ──────────────────────────────────────────

  /**
   * 遍历所有已注册仓库，按需激活/停用。
   *
   * 激活条件：玩家在附近 且 区块已加载
   * 停用条件：玩家离开 且 超过 DEACTIVATE_DELAY tick
   *          或 区块卸载超过 AREA_CHECK_INTERVAL tick
   */
  private manageLifecycle(): void {
    const warehouses = this.repository.loadAll();
    const now = system.currentTick;

    for (const w of warehouses) {
      if (!w.settings.enabled) {
        this.deactivate(w.id);
        this.lastActiveTick.delete(w.id);
        continue;
      }

      const nearPlayer = this.hasNearbyPlayer(w.dimensionId, w.area);
      const isActive = this.active.includes(w.id);

      if (nearPlayer) {
        // 记录最后活跃时间和访客
        this.lastActiveTick.set(w.id, now);
        const visitor = world.getPlayers().find(
          (p) => p.dimension.id === w.dimensionId
            && isNearAreaXZ({ x: p.location.x, z: p.location.z }, w.area, PROXIMITY_MARGIN)
        );
        if (visitor) this.lastVisitor.set(w.id, visitor.id);

        // 激活（如果还未激活且区块已加载）
        if (!isActive && this.isAreaLoaded(w.id, w.dimensionId, w.area)) {
          this.activate(w.id);
        }
      } else if (isActive) {
        // 无玩家附近 → 检查停用延迟或区块卸载
        const lastActive = this.lastActiveTick.get(w.id);
        const shouldDeactivate = lastActive !== undefined
          && (now - lastActive > DEACTIVATE_DELAY);

        // 也检查区块是否已卸载
        const areaUnloaded = !this.isAreaLoaded(w.id, w.dimensionId, w.area);

        if (shouldDeactivate || areaUnloaded) {
          this.deactivate(w.id);
        }
      }
    }
  }

  /**
   * 检查指定区域是否有玩家在附近。
   */
  private hasNearbyPlayer(dimensionId: string, area: WarehouseArea): boolean {
    const players = this.playerCache.get(dimensionId);
    if (!players || players.length === 0) return false;
    return players.some((p) => isNearAreaXZ(p, area, PROXIMITY_MARGIN));
  }

  /**
   * 检查仓库区域的区块是否已加载。
   * 结果缓存在 areaLoadedCache 中，每 AREA_CHECK_INTERVAL tick 刷新一次。
   */
  private isAreaLoaded(id: WarehouseId, dimensionId: string, area: WarehouseArea): boolean {
    const now = system.currentTick;
    const lastCheck = this.lastAreaCheck.get(id) ?? 0;

    // 缓存有效期内直接返回
    if (now - lastCheck < AREA_CHECK_INTERVAL) {
      return this.areaLoadedCache.get(id) ?? false;
    }

    // 执行实际检查
    this.lastAreaCheck.set(id, now);
    const dimension = this.getDimensionSafe(dimensionId);
    if (!dimension) {
      this.areaLoadedCache.set(id, false);
      return false;
    }

    // 采样区域 8 个角落
    const { min, max } = area;
    const corners = [
      { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: min.z },
      { x: min.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: max.z },
      { x: min.x, y: max.y, z: min.z }, { x: max.x, y: max.y, z: min.z },
      { x: min.x, y: max.y, z: max.z }, { x: max.x, y: max.y, z: max.z },
    ];

    for (const corner of corners) {
      try {
        const block = dimension.getBlock(corner);
        if (!block) { this.areaLoadedCache.set(id, false); return false; }
        // 访问 permutation 确认区块真正加载
        const _ = block.permutation;
      } catch {
        this.areaLoadedCache.set(id, false);
        return false;
      }
    }

    this.areaLoadedCache.set(id, true);
    return true;
  }

  // ─── 激活/停用 ──────────────────────────────────────────────

  /**
   * 激活仓库：重置游标，加入轮询列表。
   * 不创建 runInterval——由主循环负责处理。
   *
   * 激活时通知附近玩家（仅第一次）。
   */
  private activate(id: WarehouseId): void {
    if (this.active.includes(id)) return;
    this.engine.resetCursors(id);
    this.active.push(id);

    // 通知附近玩家
    const w = this.repository.load(id);
    if (w) {
      for (const p of world.getPlayers()) {
        if (p.dimension.id !== w.dimensionId) continue;
        if (isNearAreaXZ({ x: p.location.x, z: p.location.z }, w.area, PROXIMITY_MARGIN)) {
          try { p.sendMessage(`§a仓库 §e${w.displayName}§a 已激活`); } catch { /* 忽略 */ }
        }
      }
    }
  }

  /**
   * 停用仓库：从轮询列表移除，释放运行时模型。
   * 通知最后一个在场的玩家（即使已离开也能收到）。
   */
  private deactivate(id: WarehouseId): void {
    const idx = this.active.indexOf(id);
    if (idx === -1) return;
    this.active.splice(idx, 1);
    // 调整游标
    if (this.cursor > idx && this.cursor > 0) this.cursor--;

    const warehouse = this.repository.load(id);
    const displayName = warehouse?.displayName ?? id;
    this.lastActiveTick.delete(id);
    this.engine.releaseRuntime(id);

    // 通知最后一位访客
    this.messageLastVisitor(id, `§7仓库 §e${displayName}§7 已休眠`);
    this.lastVisitor.delete(id);
  }

  /**
   * 停用所有仓库（保留主循环）。
   */
  private stopAll(): void {
    for (const id of [...this.active]) {
      const warehouse = this.repository.load(id);
      this.messageLastVisitor(id, `§7仓库 §e${warehouse?.displayName ?? id}§7 调度已停止`);
      this.engine.releaseRuntime(id);
    }
    this.active.length = 0;
    this.lastVisitor.clear();
  }

  // ─── tick 预算分配 ──────────────────────────────────────────

  /**
   * 在预算内处理仓库。
   *
   * 每 tick 最多处理 BUDGET_PER_TICK（=1）个仓库。
   * 被选中的仓库处理一个物品槽后立即结束，下个 tick 轮到下一个仓库。
   *
   * 效果：负载被均匀分摊到不同 tick，单 tick 峰值可控。
   */
  private processWithBudget(): void {
    if (this.active.length === 0) return;
    if (this.playerCache.size === 0) return;

    // 防越界
    this.cursor = this.cursor % this.active.length;
    const selected: WarehouseId[] = [];

    // 按预算选取仓库
    for (let i = 0; i < BUDGET_PER_TICK && i < this.active.length; i++) {
      const idx = (this.cursor + i) % this.active.length;
      selected.push(this.active[idx]);
    }

    // 处理选中的仓库
    for (const id of selected) {
      try {
        this.engine.processWarehouse(id);
      } catch (error) {
        log.error(`仓库 ${id} 调度出错: ${error}`);
      }
    }

    // 推进游标
    this.cursor = (this.cursor + BUDGET_PER_TICK) % this.active.length;
  }

  // ─── 通知 ──────────────────────────────────────────────────

  private messageLastVisitor(warehouseId: WarehouseId, message: string): void {
    const visitorId = this.lastVisitor.get(warehouseId);
    if (!visitorId) return;
    for (const player of world.getPlayers()) {
      if (player.id !== visitorId) continue;
      try { player.sendMessage(message); } catch { /* 离线 */ }
      break;
    }
  }

  // ─── 工具 ──────────────────────────────────────────────────

  private getDimensionSafe(dimensionId: string): import("@minecraft/server").Dimension | undefined {
    try { return world.getDimension(dimensionId); } catch { return undefined; }
  }
}
