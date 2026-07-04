/**
 * 世界访问端口。
 *
 * 封装 Minecraft world/dimension/block 的获取操作。
 * 所有方法必须捕获未加载区块、坐标越界等异常并返回 undefined。
 */

import type { BlockLocation, DimensionId, WarehouseArea } from "../../domain/shared/identifiers";

export interface ContainerBlockInfo {
  typeId: string;
  occupiedLocations: BlockLocation[];
  isHopper: boolean;
  isDoubleChest: boolean;
}

export interface WorldAccessPort {
  /** 安全获取维度，失败返回 undefined */
  getDimension(dimensionId: DimensionId): unknown | undefined;

  /** 获取方块类型和容器占用坐标 */
  getContainerBlockInfo(
    dimensionId: DimensionId,
    location: BlockLocation
  ): ContainerBlockInfo | undefined;

  /** 扫描区域内所有容器方块 */
  scanArea(
    dimensionId: DimensionId,
    area: WarehouseArea
  ): Record<string, ContainerBlockInfo>;

  /** 检查坐标所在区块是否已加载 */
  isAreaLoaded(dimensionId: DimensionId, area: WarehouseArea): boolean;

  /** 安全获取方块 */
  tryGetBlock(dimensionId: DimensionId, location: BlockLocation): unknown | undefined;
}
