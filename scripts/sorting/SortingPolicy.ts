/**
 * 分拣路由优先级策略。
 *
 * 纯领域逻辑，不依赖 Minecraft 运行时。
 * 输入：候选容器状态；输出：按优先级排序的路由级别列表。
 * 当前源码真实优先级：大宗 -> 普通同类 -> 同族 -> 自动创建 -> 杂项。
 */

import type { CandidateState, RouteLevel, RoutePlan } from "./types";

/**
 * 根据候选容器状态计算路由优先级顺序。
 *
 * @param state - 候选容器状态快照
 * @returns 按优先级降序排列的路由级别数组
 */
export function computeRouteOrder(state: CandidateState): RouteLevel[] {
  const order: RouteLevel[] = [];
  if (state.bulkNonEmptyMatching) order.push("bulk");
  if (state.normalHasType) order.push("normal");
  if (state.familyEnabledAndMatching) order.push("family");
  if (state.autoCreateEnabledAndEmptyNormal) order.push("autocreate");
  if (state.miscAvailable) order.push("misc");
  return order;
}

/**
 * 生成路由计划。
 *
 * @param state - 候选容器状态快照
 * @returns 包含路由级别的计划对象
 */
export function planRoute(state: CandidateState): RoutePlan {
  return { levels: computeRouteOrder(state) };
}
