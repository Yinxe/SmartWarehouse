/**
 * 坐标与区域工具函数 —— 领域层。
 *
 * 纯数学运算，不依赖任何 Minecraft 运行时 API。
 */

import type { BlockLocation, WarehouseArea } from "../types";

/**
 * 生成坐标位置键，用于在 Map 中快速索引和查找容器。
 * 格式为 "维度ID|x|y|z"。
 */
export function locationKey(dimensionId: string, location: BlockLocation): string {
  return `${dimensionId}|${location.x}|${location.y}|${location.z}`;
}

/**
 * 将两个对角坐标归一化为标准的 WarehouseArea。
 */
export function normalizeArea(a: BlockLocation, b: BlockLocation): WarehouseArea {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

/**
 * 计算仓库区域的体积（包含的方块总数）。
 */
export function areaVolume(area: WarehouseArea): number {
  return (area.max.x - area.min.x + 1) * (area.max.y - area.min.y + 1) * (area.max.z - area.min.z + 1);
}

/**
 * 判断玩家是否在仓库区域的圆形检测范围内。
 *
 * 以仓库水平中心为圆心，半对角线 + 余量作为检测半径。
 */
export function isNearAreaXZ(
  point: { x: number; z: number },
  area: WarehouseArea,
  margin: number
): boolean {
  const cx = (area.min.x + area.max.x) / 2;
  const cz = (area.min.z + area.max.z) / 2;
  const hw = (area.max.x - area.min.x) / 2;
  const hz = (area.max.z - area.min.z) / 2;
  const radius = Math.sqrt(hw * hw + hz * hz) + margin;
  const dx = point.x - cx;
  const dz = point.z - cz;
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * 判断给定坐标是否位于仓库区域内部（包含边界）。
 */
export function isInsideArea(location: BlockLocation, area: WarehouseArea): boolean {
  return (
    location.x >= area.min.x &&
    location.x <= area.max.x &&
    location.y >= area.min.y &&
    location.y <= area.max.y &&
    location.z >= area.min.z &&
    location.z <= area.max.z
  );
}

/**
 * 比较两个方块坐标，用于确定"主要位置"的排序。
 * 顺序：先 x、再 z、最后 y。
 */
export function compareLocationForPrimary(a: BlockLocation, b: BlockLocation): number {
  if (a.x !== b.x) return a.x - b.x;
  if (a.z !== b.z) return a.z - b.z;
  return a.y - b.y;
}

/**
 * 检查两个仓库区域之间是否存在重叠或间距不足。
 */
export function areasTooClose(a: WarehouseArea, b: WarehouseArea, spacing: number): boolean {
  return (
    a.min.x - spacing <= b.max.x &&
    a.max.x + spacing >= b.min.x &&
    a.min.y - spacing <= b.max.y &&
    a.max.y + spacing >= b.min.y &&
    a.min.z - spacing <= b.max.z &&
    a.max.z + spacing >= b.min.z
  );
}
