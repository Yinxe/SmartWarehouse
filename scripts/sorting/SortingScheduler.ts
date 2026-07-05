/**
 * ============================================================================
 * SortingScheduler —— 二级调度系统
 * ============================================================================
 *
 * 架构：
 *
 *   LifecycleMaster（1 × runInterval, 10tick）
 *     ┃ 仅负责：玩家缓存 + 仓库激活/停用
 *     ┃ 不加载仓库数据（只读轻量索引）
 *     ┃
 *     ┣━ 附近有玩家 → activate()
 *     ┃    ┗━ 创建仓库级 runInterval（速度可配）
 *     ┃       ┗━ processWarehouse() → 1 槽/tick
 *     ┃
 *     ┗━ 无玩家 → deactivate()
 *          ┗━ clearRun() + 释放运行时
 *
 *   边界显示（BoundaryDisplay 独立管理）
 *     ┗━ 独立 runInterval(40tick) 粒子重绘
 *
 * 设计原则：
 * 1. LifecycleMaster 从不调用 loadAll()，只遍历轻量缓存
 * 2. 活跃仓库数 ≈ 附近玩家数 × 每人仓库数（通常 2-5）
 * 3. 仓库 interval 随激活/停用动态创建销毁
 * 4. 效果已节流（每 tick 最多 1 次粒子）
 * ============================================================================
 */

import { system, world } from "@minecraft/server";
import type { WarehouseArea, WarehouseId } from "../types";
import { WarehouseRepository } from "../persistence/WarehouseRepository";
import { SorterEngine } from "./SorterEngine";
import { Logger } from "../util/Logger";
import { isNearAreaXZ } from "../util/Vector";

const log = new Logger("SortingScheduler");

// ============================================================================
// 常量
// ============================================================================

/** 主循环间隔（10 tick ≈ 0.5 次/秒，生命周期变化不需要高频检测） */
const LIFECYCLE_INTERVAL = 10;

/** 仓库区域外扩格数 */
const PROXIMITY_MARGIN = 8;

/** 玩家离开后停用仓库的延迟 tick（60 tick ≈ 3 秒） */
const DEACTIVATE_DELAY = 60;

// ============================================================================
// 仓库区域缓存——避免 LifecycleMaster 调用 loadAll()
// ============================================================================

export interface WarehouseAreaInfo {
  dimensionId: string;
  area: WarehouseArea;
  enabled: boolean;
}

// ============================================================================
// 调度器
// ============================================================================

export class SortingScheduler {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly engine: SorterEngine
  ) {}

  // ── 主循环句柄 ──
  private masterHandle: number | undefined;

  // ── 活跃仓库状态 ──
  private readonly intervals = new Map<WarehouseId, number>();   // ID → runInterval handle
  private readonly lastActiveTick = new Map<WarehouseId, number>();

  // ── 玩家缓存 ──
  private playerCache = new Map<string, { x: number; z: number }[]>();

  // ── 轻量仓库缓存 ──
  private warehouseCache = new Map<WarehouseId, WarehouseAreaInfo>();
  private cacheVersion = 0;  // 仓库数据变化时递增，触发缓存刷新
  private lastCacheLoad = -1;    // 上一次加载缓存的版本号

  // ── 通知 ──
  private readonly lastVisitor = new Map<WarehouseId, string>();

  // ─── 公开 API ──────────────────────────────────────────────

  get activeCount(): number {
    return this.intervals.size;
  }

  /** 标记仓库缓存需要刷新（由外部在仓库创建/删除/设置变化时调用） */
  markCacheDirty(): void {
    this.cacheVersion++;
  }

  start(): void {
    this.stop();
    this.masterHandle = system.runInterval(() => this.tick(), LIFECYCLE_INTERVAL);
    log.info("生命周期主循环已启动（间隔=10 tick）");
  }

  stop(): void {
    // 停用所有活跃仓库
    for (const [id, handle] of [...this.intervals]) {
      system.clearRun(handle);
      this.engine.releaseRuntime(id);
    }
    this.intervals.clear();
    this.lastActiveTick.clear();
    this.lastVisitor.clear();

    // 停止主循环
    if (this.masterHandle !== undefined) {
      system.clearRun(this.masterHandle);
      this.masterHandle = undefined;
    }
    log.info("调度器已停止");
  }

  // ─── 主循环 ────────────────────────────────────────────────

  private tick(): void {
    this.refreshPlayerCache();
    this.ensureCacheLoaded();
    this.manageLifecycle();
  }

  // ─── 玩家缓存 ──────────────────────────────────────────────

  private refreshPlayerCache(): void {
    this.playerCache.clear();
    for (const p of world.getPlayers()) {
      const dim = p.dimension.id;
      let list = this.playerCache.get(dim);
      if (!list) { list = []; this.playerCache.set(dim, list); }
      list.push({ x: p.location.x, z: p.location.z });
    }
  }

  // ─── 仓库缓存 ──────────────────────────────────────────────

  /**
   * 惰性加载缓存——只在首次调用或缓存被标记脏时重建。
   * 仓库元数据只在用户主动修改设置时变化（创建/删除/启停/改名），
   * 不需要每 tick 轮询刷新。
   */
  private ensureCacheLoaded(): void {
    if (this.cacheVersion === this.lastCacheLoad) return;
    this.lastCacheLoad = this.cacheVersion;
    this.warehouseCache.clear();
    for (const meta of this.repository.loadAllMeta()) {
      this.warehouseCache.set(meta.id, {
        dimensionId: meta.dimensionId,
        area: meta.area,
        enabled: meta.settings?.enabled ?? true,
      });
    }
  }

  // ─── 生命周期 ──────────────────────────────────────────────

  /**
   * 遍历所有已注册仓库，按需激活/停用。
   *
   * 激活：玩家在附近 → 创建仓库级 runInterval
   * 停用：玩家离开超过 DEACTIVATE_DELAY → clearRun + 释放运行时
   *
   * 仓库级 interval 的处理频率由仓库自己的 processingSpeed 决定，
   * 不在此处控制。
   */
  private manageLifecycle(): void {
    const now = system.currentTick;
    const activeIds = new Set(this.intervals.keys());

    // 遍历所有已注册仓库
    for (const [id, info] of this.warehouseCache) {
      if (!info.enabled) {
        this.deactivate(id);
        continue;
      }

      const nearPlayer = this.hasNearbyPlayer(info.dimensionId, info.area);
      const isActive = activeIds.has(id);

      if (nearPlayer) {
        this.lastActiveTick.set(id, now);
        // 记录访客
        const visitor = world.getPlayers().find(p =>
          p.dimension.id === info.dimensionId
          && isNearAreaXZ({ x: p.location.x, z: p.location.z }, info.area, PROXIMITY_MARGIN)
        );
        if (visitor) this.lastVisitor.set(id, visitor.id);

        if (!isActive) {
          // 读取仓库配置获取 processingSpeed
          const w = this.repository.load(id);
          if (w) this.activate(id, w.settings.processingSpeed ?? 8);
        }
      } else if (isActive) {
        const lastActive = this.lastActiveTick.get(id);
        if (lastActive !== undefined && now - lastActive > DEACTIVATE_DELAY) {
          this.deactivate(id);
        }
      }
    }
  }

  private hasNearbyPlayer(dimensionId: string, area: WarehouseArea): boolean {
    const players = this.playerCache.get(dimensionId);
    if (!players) return false;
    return players.some(p => isNearAreaXZ(p, area, PROXIMITY_MARGIN));
  }

  // ─── 激活/停用 ──────────────────────────────────────────────

  /**
   * 激活仓库：创建仓库级 runInterval。
   * interval 只在该仓库活跃期间存在。
   */
  private activate(id: WarehouseId, speed: number): void {
    if (this.intervals.has(id)) return;
    this.engine.resetCursors(id);

    const handle = system.runInterval(() => {
      try {
        this.engine.processWarehouse(id);
      } catch (error) {
        log.error(`仓库 ${id} 调度出错: ${error}`);
      }
    }, speed);

    this.intervals.set(id, handle);
  }

  /**
   * 停用仓库：销毁仓库级 interval + 释放运行时。
   */
  private deactivate(id: WarehouseId): void {
    const handle = this.intervals.get(id);
    if (handle === undefined) return;

    system.clearRun(handle);
    this.intervals.delete(id);
    this.lastActiveTick.delete(id);
    this.engine.releaseRuntime(id);

    const info = this.warehouseCache.get(id);
    this.messageLastVisitor(id, `§7仓库 §e${id}§7 已休眠`);
    this.lastVisitor.delete(id);
  }

  // ─── 外部刷新接口 ──────────────────────────────────────────

  /**
   * 刷新单个仓库的调度（速度/启用状态变化时调用）。
   */
  refreshOne(id: WarehouseId): void {
    const meta = this.repository.load(id);
    if (!meta || !meta.settings?.enabled) {
      this.deactivate(id);
      return;
    }

    // 如果仓库正在活跃，用新速度重启 interval
    if (this.intervals.has(id)) {
      this.deactivate(id);
      this.activate(id, meta.settings.processingSpeed ?? 8);
    }
  }

  // ─── 通知 ──────────────────────────────────────────────────

  private messageLastVisitor(warehouseId: WarehouseId, message: string): void {
    const visitorId = this.lastVisitor.get(warehouseId);
    if (!visitorId) return;
    for (const p of world.getPlayers()) {
      if (p.id !== visitorId) continue;
      try { p.sendMessage(message); } catch { /* 忽略 */ }
      break;
    }
  }
}
