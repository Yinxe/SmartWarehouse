/**
 * 快速整理处理器。
 *
 * 玩家潜行 + 信物 + 方块点击时触发。
 * 整理容器或玩家背包。
 */

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { SlotOrganizer } from "../sorting/io/SlotOrganizer";
import { formatOrganizeResult } from "../ui/OrganizeFormatter";
import { isSupportedContainerType } from "../sorting/ContainerTypes";
import { Logger } from "../util/Logger";

const log = new Logger("QuickOrganize");

export function triggerQuickOrganize(player: Player, block: import("@minecraft/server").Block): void {
  const organizer = new SlotOrganizer();

  if (isSupportedContainerType(block.typeId)) {
    system.run(() => {
      try {
        const inv = block.getComponent("inventory")?.container;
        if (!inv) { player.sendMessage("§c无法获取容器"); return; }
        const result = organizer.organize(inv);
        const name = block.typeId.replace("minecraft:", "");
        for (const line of formatOrganizeResult(result, name)) player.sendMessage(line);
      } catch (error) {
        log.error(`容器整理失败: ${error}`);
        player.sendMessage("§c容器整理失败");
      }
    });
  } else {
    system.run(() => {
      try {
        const invComp = player.getComponent("inventory") as
          { container: import("@minecraft/server").Container } | undefined;
        if (!invComp?.container) { player.sendMessage("§c无法获取背包容器"); return; }
        const analysis = organizer.analyze(invComp.container, { startSlot: 9, endSlot: 36 });
        const result = organizer.apply(invComp.container, analysis);
        for (const line of formatOrganizeResult(result, "背包")) player.sendMessage(line);
      } catch (error) {
        log.error(`背包整理失败: ${error}`);
        player.sendMessage("§c背包整理失败");
      }
    });
  }
}
