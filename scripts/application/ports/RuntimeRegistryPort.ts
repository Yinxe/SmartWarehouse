/**
 * 运行时索引端口。
 *
 * 管理内存中的仓库运行时模型缓存。
 * 运行时索引不持久化，重启后冷启动重建。
 */

export interface RuntimeRegistryPort {
  markDirty(warehouseId: string): void;
  delete(warehouseId: string): void;
  resetCursor(warehouseId: string): void;
}
