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


import type { Vector3 } from "@minecraft/server";

/**
 * 物品家族类型定义。每种家族包含一组互斥的物品 ID。
 */
export interface ItemFamily {
  /** 族 ID，用于持久化配置和索引 key */
  id: string;
  /** 中文显示名，用于 UI */
  displayName: string;
  /** 该族包含的所有物品 typeId */
  items: readonly string[];
}

/**
 * 以下类型已迁移到 Domain 层，从 Domain 模块 re-export 以保持向后兼容。
 */
export {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  SPEED_LABELS,
  DEFAULT_PROCESSING_SPEED,
  DEFAULT_WAREHOUSE_SETTINGS,
} from "./warehouse/WarehouseTypes";

export type {
  WarehouseSettings,
  WarehouseIndex,
  WarehouseMeta,
  StoredContainer,
  ContainerStats,
  WarehouseContainerShard,
  WarehouseData,
} from "./warehouse/WarehouseTypes";

export type { RuntimeContainer, WarehouseRuntimeModel } from "./warehouse/WarehouseRuntimeModel";

/**
 * 选区会话状态，用于记录玩家正在进行的方块选区操作。
 * 支持两种操作：创建仓库和调整仓库大小。
 */
export type SelectionSession =
  | {
      type: "createWarehouse";
      warehouseName: string;
      defaultNewContainerRole: ContainerRole;
      defaultNewContainerEnabled: boolean;
      pointA?: BlockLocation;
    }
  | {
      type: "resizeWarehouse";
      warehouseId: WarehouseId;
      pointA?: BlockLocation;
    };

/**
 * 将 Minecraft 的 Vector3（浮点数坐标）转换为 BlockLocation（整数方块坐标）。
 */
export function toBlockLocation(vector: Vector3): BlockLocation {
  return { x: Math.floor(vector.x), y: Math.floor(vector.y), z: Math.floor(vector.z) };
}
