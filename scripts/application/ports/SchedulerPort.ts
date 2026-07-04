/**
 * 调度器端口。
 *
 * 定义分拣任务调度/取消/刷新的接口，与 Minecraft tick 系统解耦。
 */

export interface SchedulerPort {
  start(warehouseId: string, tickInterval: number, callback: () => void): void;
  stop(warehouseId: string): void;
  stopAll(): void;
  refresh(warehouseId: string, tickInterval: number): void;
}
