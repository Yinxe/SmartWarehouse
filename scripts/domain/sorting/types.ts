/**
 * 分拣领域类型。
 *
 * 定义路由优先级策略所需的类型。
 * 纯领域层，不依赖 Minecraft 运行时 API。
 */

/** 路由优先级级别 */
export type RouteLevel = "bulk" | "normal" | "family" | "autocreate" | "misc";

/** 候选容器状态，决定路由决策 */
export interface CandidateState {
  bulkNonEmptyMatching: boolean;
  normalHasType: boolean;
  familyEnabledAndMatching: boolean;
  autoCreateEnabledAndEmptyNormal: boolean;
  miscAvailable: boolean;
}

/** 路由计划：按优先级排序的目标级别列表 */
export interface RoutePlan {
  levels: RouteLevel[];
}
