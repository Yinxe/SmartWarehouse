/**
 * 容器库存相关纯领域函数。
 *
 * 不依赖 Minecraft Container/Block/Dimension 运行时类型，
 * 只允许使用 ItemStack 和项目值对象。
 */

import type { ItemStack } from "@minecraft/server";
import { SHULKER_BOX_IDS } from "./ContainerTypes";

/**
 * 判断物品堆是否为潜影盒（任意颜色）。
 */
export function isShulkerBoxItem(stack: ItemStack): boolean {
  return SHULKER_BOX_IDS.has(stack.typeId);
}
