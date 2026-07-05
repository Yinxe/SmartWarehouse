/**
 * 容器整理相关类型定义 —— 领域层。
 *
 * 纯数据类型，不依赖 Minecraft 运行时 API。
 * 供 OrganizeFormatter（领域）和 SlotOrganizer（基础设施）跨层共享。
 */

import type { MessinessScore } from "../sorting/MessinessScore";

/**
 * 整理选项。
 */
export interface OrganizeOptions {
  startSlot: number;
  endSlot: number;
  sortBy: "typeId";
  lockedSlots?: Set<number>;
}

/**
 * 整理结果。
 */
export interface OrganizeResult {
  success: boolean;
  movedStacks: number;
  beforeStacks: number;
  afterStacks: number;
  beforeTypes: number;
  afterTypes: number;
  perType: Record<string, { stacks: number; total: number }>;
  totalSlots: number;
  usedSlots: number;
  usagePercent: number;
  error?: string;
  /** 整理前后的混乱度评分（仅 analyze/organize 时有效） */
  messiness?: MessinessScore;
}
