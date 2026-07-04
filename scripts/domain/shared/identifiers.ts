/**
 * 领域层共享值对象。
 *
 * 这些类型在 Domain 中直接使用，不依赖 Minecraft 运行时 API。
 * BlockLocation 使用整数方块坐标，与 Vector3（浮点数）区分。
 */

/** 维度 ID，如 "minecraft:overworld" */
export type DimensionId = string;

/** 仓库唯一标识符 */
export type WarehouseId = string;

/** 容器唯一标识符 */
export type ContainerId = string;

/** 方块整数坐标 */
export interface BlockLocation {
  x: number;
  y: number;
  z: number;
}

/** 仓库区域，min/max 经过归一化 */
export interface WarehouseArea {
  min: BlockLocation;
  max: BlockLocation;
}

/** 容器角色 */
export type ContainerRole = "normal" | "misc" | "bulk" | "input";

/** 处理速度（游戏刻间隔） */
export type ProcessingSpeed = 4 | 8 | 16 | 20;
