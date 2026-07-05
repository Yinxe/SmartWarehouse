/**
 * 容器 ID 生成函数 —— 领域层。
 *
 * 纯字符串运算，不依赖任何 Minecraft 运行时 API。
 */

import type { BlockLocation, ContainerId, DimensionId } from "../types";
import { locationKey } from "./Vector";

/**
 * 根据维度 ID 和容器的主位置生成唯一的容器标识符。
 */
export function makeContainerId(dimensionId: DimensionId, primaryLocation: BlockLocation): ContainerId {
  return locationKey(dimensionId, primaryLocation);
}

/**
 * 生成运行时占用位置索引的定位键字符串。
 */
export function makeOccupiedLocationKey(dimensionId: DimensionId, location: BlockLocation): string {
  return locationKey(dimensionId, location);
}
