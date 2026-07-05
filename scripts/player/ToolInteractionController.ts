/**
 * ============================================================================
 * ToolInteractionController —— 工具交互事件注册（输入层瘦路由）
 * ============================================================================
 *
 * 职责：
 * 1. 注册 playerInteractWithBlock、itemUse、playerLeave 等 Minecraft 事件
 * 2. 校验信物匹配和基础上下文
 * 3. 委托给 handlers/ 下的处理器
 *
 * 不包含任何业务逻辑——仅做事件绑定和路由。
 * ============================================================================
 */

import { world, system } from "@minecraft/server";
import { toBlockLocation } from "../types";
import { Logger } from "../util/Logger";
import { isSupportedContainerType } from "../lib/ContainerTypes";
import type { WarehouseRepository } from "../persistence/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { ModConfigStore } from "../persistence/ModConfigStore";
import { clearSessionById } from "./SelectionSessionStore";
import { showMainMenu } from "../ui/MainMenu";
import { handleContainerClick } from "./containerClickHandler";
import { handleNonContainerClick } from "./nonContainerClickHandler";
import { triggerQuickOrganize } from "./quickOrganizeHandler";

const DEBOUNCE_MS = 250;
const log = new Logger("ToolInteraction");
const recentUseOn = new Map<string, number>();

export function registerToolInteraction(
  repository: WarehouseRepository,
  service: WarehouseService,
  configStore: ModConfigStore
): void {
  // ── 方块交互事件（手持信物右键方块） ──────────────────
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const player = event.player;
    const itemStack = event.itemStack;
    if (!itemStack || !configStore.isToken(itemStack.typeId)) return;
    if (!event.isFirstEvent) return;
    recentUseOn.set(player.id, Date.now());
    event.cancel = true;
    const blockLocation = toBlockLocation(event.block.location);

    if (player.isSneaking) {
      triggerQuickOrganize(player, event.block);
    } else if (isSupportedContainerType(event.block.typeId)) {
      handleContainerClick(player, service, event.block.dimension.id, blockLocation);
    } else {
      handleNonContainerClick(player, service, event.block.dimension.id, blockLocation);
    }
  });

  // ── 物品使用事件（对空右键 / 兜底） ──────────────────
  world.afterEvents.itemUse.subscribe((event) => {
    const player = event.source;
    const itemStack = event.itemStack;
    if (!itemStack || !configStore.isToken(itemStack.typeId)) return;

    const lastUseOn = recentUseOn.get(player.id);
    if (lastUseOn && Date.now() - lastUseOn < DEBOUNCE_MS) return;
    recentUseOn.set(player.id, Date.now());

    const raycast = player.getBlockFromViewDirection({ maxDistance: 6 });
    if (raycast?.block && isSupportedContainerType(raycast.block.typeId)) {
      const blockLocation = toBlockLocation(raycast.block.location);
      handleContainerClick(player, service, raycast.block.dimension.id, blockLocation);
      return;
    }

    system.runTimeout(() => {
      showMainMenu(player, repository, service, configStore).catch((error) => {
        log.error(`MainMenu error for ${player.name}: ${error}`);
      });
    }, 1);
  });

  // ── 玩家离开事件 —— 清理状态 ─────────────────────────
  world.afterEvents.playerLeave.subscribe((event) => {
    recentUseOn.delete(event.playerId);
    clearSessionById(event.playerId);
  });
}
