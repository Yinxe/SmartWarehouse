/**
 * 容器类型基础设施函数。
 *
 * hasInventory 检查方块是否真正拥有物品栏（inventory）组件。
 * 某些方块虽然类型 ID 匹配容器，但可能因损坏或其他原因缺少物品栏组件。
 * 部分 Bedrock 版本中潜影盒可能使用完整组件 ID "minecraft:inventory"
 * 而非简写 "inventory"，因此同时检查两者。
 */

import type { Block } from "@minecraft/server";

/**
 * 检查方块是否真正拥有物品栏（inventory）组件。
 *
 * @param block 要检查的方块对象
 * @returns 如果方块拥有 inventory 组件，返回 true
 */
export function hasInventory(block: Block): boolean {
  const result = Boolean(block.getComponent("inventory")) || Boolean(block.getComponent("minecraft:inventory"));
  return result;
}
