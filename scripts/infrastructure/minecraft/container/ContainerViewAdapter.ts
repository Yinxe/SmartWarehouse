/**
 * ContainerView 适配器 —— 将 Minecraft Container 适配为领域层 ContainerView。
 */

import type { Container } from "@minecraft/server";
import type { ContainerView } from "../../../domain/inventory/ContainerView";

/**
 * 将 Minecraft Container 包装为只读 ContainerView。
 */
export function toContainerView(mc: Container): ContainerView {
  return {
    get size() { return mc.size; },
    get emptySlotsCount() { return mc.emptySlotsCount; },
    getItem: (slot: number) => mc.getItem(slot),
    contains: (item) => mc.contains(item),
  };
}
