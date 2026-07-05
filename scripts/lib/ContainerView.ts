/**
 * 容器读取视图 —— 领域层。
 *
 * 仅暴露读取操作的容器接口。
 * Minecraft 的 Container 类型包含 addItem/setItem 等写操作，
 * 这些留在基础设施层。领域层只需读取能力：
 * - getItem(slot) → 读槽位物品
 * - contains(item) → 检查是否包含某物品
 * - size / emptySlotsCount → 容量信息
 *
 * ItemStack 可以进入领域层，因为它是纯数据对象，
 * 不持有服务器连接，可以在测试中 new ItemStack("stone", 1)。
 */

import { ItemStack } from "@minecraft/server";

/**
 * 容器读取视图。
 * 实现由基础设施层提供（适配 Minecraft Container）。
 */
export interface ContainerView {
  readonly size: number;
  readonly emptySlotsCount: number;
  getItem(slot: number): ItemStack | undefined;
  contains(item: ItemStack): boolean;
}

/**
 * 判断容器是否全空。
 */
export function isContainerEmpty(container: ContainerView): boolean {
  return container.emptySlotsCount === container.size;
}

/**
 * 检查容器中是否包含指定类型的物品。
 */
export function containerHasType(container: ContainerView, typeId: string): boolean {
  return container.contains(new ItemStack(typeId, 1));
}

/**
 * 计算容器对于指定家族的纯度分数。
 *
 * 纯度 = 容器中属于目标家族的物品种类数 ÷ 容器中所有物品种类总数。
 * 分数范围 [0, 1]：
 * - 1.0 = 容器中只有该家族的物品（最纯）
 * - 0.0 = 容器中没有该家族的物品
 */
export function getFamilyPurity(container: ContainerView, familyMemberSet: Set<string>): number {
  const allTypes = new Set<string>();
  const targetTypes = new Set<string>();

  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;
    const typeId = item.typeId;
    if (allTypes.has(typeId)) continue;
    allTypes.add(typeId);
    if (familyMemberSet.has(typeId)) {
      targetTypes.add(typeId);
    }
  }

  if (allTypes.size === 0) return 0;
  return targetTypes.size / allTypes.size;
}
