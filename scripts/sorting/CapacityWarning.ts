/**
 * 容量预警 —— 领域层配置与纯计算逻辑。
 *
 * 定义容量告警的阈值、冷却时间等常量，
 * 以及组级容量判定的纯函数。
 * 不依赖 Minecraft 运行时类型。
 */

// ─── 常量 ───────────────────────────────────────────────────────

/** 容量预警阈值：已用槽位占比超过此值视为"容量告急" */
export const CAPACITY_WARNING_THRESHOLD = 0.9;

/** 分拣引擎容量预警冷却 tick 数（5 秒 = 100 tick） */
export const SORTING_WARNING_COOLDOWN_TICKS = 100;

/** 全满预警冷却 tick 数（15 秒 = 300 tick，比一般预警长） */
export const ALL_FULL_COOLDOWN_TICKS = 300;

// ─── 纯计算逻辑 ─────────────────────────────────────────────────

/** 组级容量判定结果 */
export interface GroupCapacityResult {
  /** 总已用槽位数 */
  totalUsed: number;
  /** 总槽位数 */
  totalSlots: number;
  /** 使用率（已用/总） */
  usageRatio: number;
  /** 是否达到预警阈值 */
  isWarning: boolean;
}

/**
 * 计算候选容器组的容量使用情况。
 *
 * @param totalUsed - 组内所有容器的总已用槽位数
 * @param totalSlots - 组内所有容器的总槽位数
 * @returns 组级容量判定结果
 */
export function computeGroupCapacity(totalUsed: number, totalSlots: number): GroupCapacityResult {
  if (totalSlots <= 0) {
    return { totalUsed: 0, totalSlots: 0, usageRatio: 0, isWarning: false };
  }
  const usageRatio = totalUsed / totalSlots;
  return {
    totalUsed,
    totalSlots,
    usageRatio,
    isWarning: usageRatio >= CAPACITY_WARNING_THRESHOLD,
  };
}

/**
 * 检查冷却时间是否已过，允许发送预警消息。
 *
 * @param lastTick - 上次发送预警的 tick
 * @param currentTick - 当前 tick
 * @param cooldownTicks - 冷却 tick 数
 * @returns 如果冷却已过，可以发送新消息
 */
export function isCooldownElapsed(lastTick: number, currentTick: number, cooldownTicks: number): boolean {
  return currentTick - lastTick >= cooldownTicks;
}

/**
 * 检查降级预警条件：物品未全部放入但部分已放入，表示高级容器已满，物品降级到低级容器。
 *
 * @param originalAmount - 原始物品数量
 * @param remainingAmount - 剩余未放置物品数量
 * @param hasHigherLevelContainers - 是否有更高级别的容器
 * @returns 是否触发降级预警
 */
export function shouldTriggerOverflowWarning(
  originalAmount: number,
  remainingAmount: number,
  hasHigherLevelContainers: boolean
): boolean {
  if (!hasHigherLevelContainers) return false;
  if (remainingAmount <= 0) return false;
  return remainingAmount < originalAmount;
}
