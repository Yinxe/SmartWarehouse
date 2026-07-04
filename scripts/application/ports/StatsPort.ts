/**
 * 仓库统计端口。
 *
 * 统计数据派生自容器槽位状态，允许清空重建。
 */

export interface ContainerStatsDto {
  containerId: string;
  blockType: string;
  role: string;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
}

export interface StatsPort {
  getOrCompute(warehouseId: string, containerId: string): ContainerStatsDto | undefined;
  refresh(warehouseId: string, containerId: string): ContainerStatsDto | undefined;
  invalidate(warehouseId: string, containerIds?: string[]): void;
}
