/**
 * 容器混乱度评分 —— 领域层。
 *
 * 纯数学运算，不依赖 Minecraft Container/Block/Dimension 运行时类型。
 * 只接收已提取的 ItemStack 数组（ItemStack 允许进入 Domain）。
 */

import type { ItemStack } from "@minecraft/server";

/** 混乱度评分（含权重分解） */
export interface MessinessScore {
  /** 总分 0-1，越高越乱 */
  total: number;
  /** 顺序评分 0-1（权重 50%） */
  order: number;
  /** 堆叠评分 0-1（权重 50%） */
  stack: number;
  /** 有效范围长度（最后一个非空槽位 +1） */
  effectiveSlots: number;
  /** 逆序对数量 */
  disorderSlots: number;
  /** 非空物品数量 */
  nonEmptySlots: number;
  /** 未充分堆叠的组数 */
  suboptimalStacks: number;
}

export interface MessinessOptions {
  startSlot: number;
  endSlot: number;
  lockedSlots?: Set<number>;
}

/**
 * 计算容器混乱度评分。
 *
 * 顺序权重 50%：相邻逆序对比例。
 * 堆叠权重 50%：未充分堆叠的同种物品比例。
 *
 * @param items - 从容器中提取的 ItemStack 列表（按槽位顺序）
 * @param options - 计算选项
 * @returns 混乱度评分
 */
export function calculateMessiness(items: ItemStack[]): MessinessScore {
  const nonEmptySlots = items.length;

  if (nonEmptySlots <= 1) {
    return { total: 0, order: 0, stack: 0, effectiveSlots: nonEmptySlots, disorderSlots: 0, nonEmptySlots, suboptimalStacks: 0 };
  }

  // ── 顺序评分（50%）—— 相邻逆序对 ──
  const typeSeq = items.map((i) => i.typeId);
  let inversions = 0;
  for (let i = 0; i < typeSeq.length - 1; i++) {
    if (typeSeq[i].localeCompare(typeSeq[i + 1]) > 0) inversions++;
  }
  const maxInversions = Math.max(1, typeSeq.length - 1);
  const order = (inversions / maxInversions) * 0.5;

  // ── 堆叠评分（50%） ──
  const typeGroups = new Map<string, { stacks: number; nonFull: number }>();
  for (const item of items) {
    let g = typeGroups.get(item.typeId);
    if (!g) {
      g = { stacks: 0, nonFull: 0 };
      typeGroups.set(item.typeId, g);
    }
    g.stacks++;
    if (item.amount < item.maxAmount) g.nonFull++;
  }

  let suboptimalStacks = 0;
  for (const g of typeGroups.values()) {
    if (g.nonFull >= 2) suboptimalStacks += g.nonFull;
  }

  const stack = nonEmptySlots > 0 ? (suboptimalStacks / nonEmptySlots) * 0.5 : 0;
  const total = Math.min(1, order + stack);

  return { total, order, stack, effectiveSlots: nonEmptySlots, disorderSlots: inversions, nonEmptySlots, suboptimalStacks };
}
