/**
 * Minecraft 运行时安全访问辅助函数。
 *
 * 所有 world/dimension/block/container 访问都必须通过此层，
 * 将运行时异常归一化为 undefined。
 */

import { world } from "@minecraft/server";
import type { Dimension, Block, Container } from "@minecraft/server";

/** 安全获取维度 */
export function safeGetDimension(dimensionId: string): Dimension | undefined {
  try {
    return world.getDimension(dimensionId);
  } catch {
    return undefined;
  }
}

/** 安全获取方块 */
export function safeGetBlock(dimension: Dimension, x: number, y: number, z: number): Block | undefined {
  try {
    return dimension.getBlock({ x, y, z });
  } catch {
    return undefined;
  }
}

/** 安全获取容器 inventory 组件 */
export function safeGetInventoryContainer(block: Block): Container | undefined {
  try {
    const inv = block.getComponent("inventory");
    return inv?.container;
  } catch {
    return undefined;
  }
}

/** 安全读取槽位物品 */
export function safeGetItem(container: Container, slot: number) {
  try {
    return container.getItem(slot);
  } catch {
    return undefined;
  }
}

/** 安全设置槽位物品 */
export function safeSetItem(container: Container, slot: number, stack?: import("@minecraft/server").ItemStack): boolean {
  try {
    container.setItem(slot, stack);
    return true;
  } catch {
    return false;
  }
}

/** 安全添加物品 */
export function safeAddItem(container: Container, stack: import("@minecraft/server").ItemStack) {
  try {
    return container.addItem(stack);
  } catch {
    return stack;
  }
}
