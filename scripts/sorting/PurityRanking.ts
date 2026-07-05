/**
 * 家族纯度排序 —— 领域层。
 *
 * 纯度越高的容器越优先接收同族物品，使得家族物品自然流入更"专一"的容器，
 * 避免已混杂多个家族的容器承受过大的物品压力。
 *
 * 纯数学运算，不依赖 Minecraft 运行时类型。
 */

/** 带纯度分数的容器标识 */
export interface ScoredContainer {
  /** 容器 ID */
  id: string;
  /** 纯度分数 [0, 1]，1 = 100% 同族物品 */
  purity: number;
  /** 原始顺序索引（用于保持稳定性） */
  originalIndex: number;
}

/**
 * 按纯度降序排序候选容器。
 *
 * 纯度分数在领域层外部计算（需要读取 Minecraft 容器内容），
 * 排序逻辑本身是纯数据操作。
 *
 * @param items - 候选容器的纯度记录
 * @returns 按纯度降序排序的容器 ID 列表
 */
export function sortByPurityDescending(items: ScoredContainer[]): string[] {
  if (items.length <= 1) return items.map((i) => i.id);

  // 全部候选纯度均为 0 → 无需排序，保持原始顺序
  const hasPositivePurity = items.some((i) => i.purity > 0);
  if (!hasPositivePurity) return items.map((i) => i.id);

  // 降序排列；同纯度时按原始索引保持稳定（确定性保证）
  const sorted = [...items].sort((a, b) => b.purity - a.purity || a.originalIndex - b.originalIndex);
  return sorted.map((s) => s.id);
}
