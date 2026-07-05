/**
 * 容量阈值检查服务 —— 领域层。
 *
 * 纯数据计算，不依赖 Minecraft 运行时。
 * 计算容器组的已用/总槽位比例，判断是否达到预警阈值。
 */

/** 默认容量预警阈值（80%） */
export const CAPACITY_WARNING_THRESHOLD = 0.8;

/**
 * 单个容器的容量状态（纯数据）。
 */
export interface ContainerCapacity {
  totalSlots: number;
  usedSlots: number;
}

/**
 * 组级容量计算结果。
 */
export interface GroupCapacityResult {
  /** 总已用槽位数 */
  totalUsed: number;
  /** 总槽位数 */
  totalSlots: number;
  /** 使用率 [0, 1] */
  usageRatio: number;
  /** 是否超过阈值 */
  isWarning: boolean;
  /** 各容器的详细信息 */
  containerDetails: { id: string; usedSlots: number; totalSlots: number; ratio: number }[];
}

/**
 * 计算容器组的容量状态。
 *
 * @param containers - 容器 ID → 容量状态的映射
 * @param threshold - 预警阈值（默认 0.8）
 * @returns 组级容量计算结果
 */
export function checkGroupCapacity(
  containers: Record<string, ContainerCapacity>,
  threshold: number = CAPACITY_WARNING_THRESHOLD
): GroupCapacityResult {
  let totalUsed = 0;
  let totalSlots = 0;
  const containerDetails: { id: string; usedSlots: number; totalSlots: number; ratio: number }[] = [];

  for (const [id, cap] of Object.entries(containers)) {
    totalUsed += cap.usedSlots;
    totalSlots += cap.totalSlots;

    if (cap.totalSlots > 0) {
      const ratio = cap.usedSlots / cap.totalSlots;
      containerDetails.push({ id, ...cap, ratio });
    }
  }

  const usageRatio = totalSlots > 0 ? totalUsed / totalSlots : 0;
  const isWarning = usageRatio >= threshold;

  return {
    totalUsed,
    totalSlots,
    usageRatio,
    isWarning,
    containerDetails,
  };
}

/**
 * 计算组级容量预警消息。
 *
 * @param result - 组级容量计算结果
 * @param groupLabel - 组标签（如 "大宗"、"普通"、"杂项"）
 * @param typeId - 物品类型 ID
 * @returns 格式化后的预警消息
 */
export function formatCapacityWarning(
  result: GroupCapacityResult,
  groupLabel: string,
  typeId: string
): string {
  const groupPct = Math.round(result.usageRatio * 100);
  const containerList = result.containerDetails
    .filter((c) => c.ratio >= CAPACITY_WARNING_THRESHOLD)
    .map((c) => `${c.id.slice(-8)}(${Math.round(c.ratio * 100)}%)`)
    .join(" ");

  return `组容量已达阈值：${groupLabel} 物品:${typeId} 容量:${groupPct}% 容器:${containerList || "（组总容量已满）"}`;
}
