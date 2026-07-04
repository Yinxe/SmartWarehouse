/**
 * 容器访问端口。
 *
 * 定义 Application 层读取和写入 Minecraft 容器的接口。
 * Domain 层禁止直接使用此端口；Domain 只能接收已解析的数据。
 * 所有方法可能因区块未加载、世界边界等运行时原因失败，
 * 实现必须处理这些异常并返回 Result 或 undefined。
 */

import type { ItemStack } from "@minecraft/server";
import type { Result } from "../../domain/shared/errors";

/** 容器运行时引用（不透明句柄，Domain 不使用） */
export interface ContainerHandle {
  readonly size: number;
  readonly emptySlotsCount: number;
}

/** 容器快照（ItemStack 克隆，允许进入 Domain） */
export interface SlotView {
  slot: number;
  item?: ItemStack;
}

export interface ContainerAccessPort {
  /** 根据容器 ID 和存储记录获取运行时容器句柄 */
  getHandle(stored: unknown): ContainerHandle | undefined;

  /** 快照指定范围的槽位 */
  snapshot(handle: ContainerHandle, startSlot?: number, endSlot?: number): SlotView[];

  /** 尝试将物品堆放入容器，返回剩余 */
  addItem(handle: ContainerHandle, stack: ItemStack): ItemStack | undefined;

  /** 设置槽位物品 */
  setSlot(handle: ContainerHandle, slot: number, stack?: ItemStack): Result<void>;

  /** 从快照恢复容器状态 */
  restore(handle: ContainerHandle, snapshot: SlotView[]): Result<void>;
}
