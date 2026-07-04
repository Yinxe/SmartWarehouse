/**
 * 仓库持久化端口。
 *
 * 定义仓库数据的读写接口，实现与 Dynamic Property 细节解耦。
 * 方法名反映业务语义而非存储机制。
 * 持久化 DTO 不允许包含 ItemStack/Container/Block/Dimension/Player。
 */

import type { WarehouseId, WarehouseArea, ContainerRole, BlockLocation } from "../../domain/shared/identifiers";

export interface WarehouseSettingsDto {
  defaultNewContainerRole: ContainerRole;
  defaultNewContainerEnabled: boolean;
  autoCreateCategories: boolean;
  enabled: boolean;
  processingSpeed: number;
  debug: boolean;
  showBoundary: boolean;
  autoSortThreshold: number;
  enabledFamilies: string[];
  capacityWarning: boolean;
}

export interface StoredContainerDto {
  id: string;
  dimensionId: string;
  primaryLocation: BlockLocation;
  occupiedLocations: BlockLocation[];
  role: ContainerRole;
  enabled: boolean;
  discoveredAt: number;
  updatedAt: number;
}

export interface WarehouseMetaDto {
  version: number;
  id: string;
  displayName: string;
  dimensionId: string;
  area: WarehouseArea;
  ownerId: string;
  settings: WarehouseSettingsDto;
  containerShardCount: number;
  containerCount: number;
  containerShardGeneration: number;
}

export interface WarehouseRepositoryPort {
  /** 加载完整仓库（含所有容器分片） */
  load(id: string): WarehouseMetaDto & { containers: Record<string, StoredContainerDto> } | undefined;

  /** 加载所有仓库的元数据+容器 */
  loadAll(): (WarehouseMetaDto & { containers: Record<string, StoredContainerDto> })[];

  /** 仓库是否存在 */
  exists(id: string): boolean;

  /** 创建仓库 */
  save(data: WarehouseMetaDto & { containers: Record<string, StoredContainerDto> }): void;

  /** 仅更新元数据 */
  saveMetaOnly(data: WarehouseMetaDto): void;

  /** 增量更新容器数据 */
  patchContainers(id: string, containers: Record<string, StoredContainerDto>): void;

  /** 删除仓库 */
  delete(id: string): void;
}
