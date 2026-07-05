/**
 * 仓库核心领域类型。
 *
 * 这些类型定义仓库、容器、设置的纯数据结构，
 * 不依赖 Minecraft 运行时 API，允许 ItemStack 进入。
 */

import type { BlockLocation, WarehouseArea, ContainerRole, ProcessingSpeed, WarehouseId, ContainerId, DimensionId } from "./identifiers";

/** 仓库全局设置 */
export interface WarehouseSettings {
  defaultNewContainerRole: ContainerRole;
  defaultNewContainerEnabled: boolean;
  autoCreateCategories: boolean;
  enabled: boolean;
  processingSpeed: ProcessingSpeed;
  debug: boolean;
  showBoundary: boolean;
  autoSortThreshold: number;
  enabledFamilies: string[];
  capacityWarning: boolean;
}

/** 默认仓库设置值 */
export const DEFAULT_WAREHOUSE_SETTINGS: WarehouseSettings = {
  defaultNewContainerRole: "normal",
  defaultNewContainerEnabled: true,
  autoCreateCategories: true,
  enabled: true,
  processingSpeed: 8,
  debug: false,
  showBoundary: false,
  autoSortThreshold: 0,
  enabledFamilies: [],
  capacityWarning: true,
};

/** 仓库元数据 */
export interface WarehouseMeta {
  version: 1;
  id: WarehouseId;
  displayName: string;
  dimensionId: DimensionId;
  area: WarehouseArea;
  ownerId: string;
  settings: WarehouseSettings;
  containerShardCount: number;
  containerCount: number;
  containerShardGeneration: number;
}

/** 已存储的容器数据 */
export interface StoredContainer {
  id: ContainerId;
  dimensionId: DimensionId;
  primaryLocation: BlockLocation;
  occupiedLocations: BlockLocation[];
  role: ContainerRole;
  enabled: boolean;
  discoveredAt: number;
  updatedAt: number;
}

/** 容器统计 */
export interface ContainerStats {
  containerId: ContainerId;
  blockType: string;
  role: ContainerRole;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
}

/** 仓库容器分片 */
export interface WarehouseContainerShard {
  version: 1;
  warehouseId: WarehouseId;
  shardIndex: number;
  containers: Record<ContainerId, StoredContainer>;
}

/** 仓库完整数据（元数据 + 所有容器，运行时聚合用，不用于持久化） */
export interface WarehouseData extends WarehouseMeta {
  containers: Record<ContainerId, StoredContainer>;
}

/** 仓库索引 */
export interface WarehouseIndex {
  version: 1;
  warehouses: WarehouseId[];
}

/** 容器角色中文描述 */
export const ROLE_DESCRIPTIONS: Record<ContainerRole, string> = {
  normal: "多物品分类",
  misc: "存储无法归类的物品",
  bulk: "单物品分类",
  input: "物品从此流入自动分拣系统",
};

export const ROLE_LABELS: Record<ContainerRole, string> = {
  normal: "普通仓位",
  misc: "其他仓位",
  bulk: "大宗仓位",
  input: "输入",
};

export const ROLE_ORDER: ContainerRole[] = ["input", "normal", "misc", "bulk"];

export const SPEED_LABELS: Record<ProcessingSpeed, string> = {
  4: "极速（4 tick）",
  8: "快速（8 tick）",
  16: "标准（16 tick）",
  20: "慢速（20 tick）",
};

export const DEFAULT_PROCESSING_SPEED: ProcessingSpeed = 8;
