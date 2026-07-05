/**
 * 背包整理命令处理器。
 *
 * 处理 sw:organize 命令，使用 SlotOrganizer 对玩家背包（9~35 号槽位）进行排序合并。
 */

import { system, type CustomCommandOrigin } from "@minecraft/server";
import type { EntityInventoryComponent } from "@minecraft/server";
import { SlotOrganizer } from "../../sorting/SlotOrganizer";
import { formatOrganizeResult } from "../../lib/OrganizeFormatter";
import { parseAnyPlayer, trySendMessage, success, failure } from "../validators/PermissionValidator";

/**
 * 执行背包整理操作。
 */
export function handleOrganize(origin: CustomCommandOrigin) {
  const result = parseAnyPlayer(origin);
  if (!result.ok) return failure(result.message);
  const { player } = result;

  system.runTimeout(() => {
    try {
      const invComp = player.getComponent("inventory") as EntityInventoryComponent | undefined;
      if (!invComp?.container) {
        trySendMessage(player, "§c无法获取背包容器");
        return;
      }

      const organizer = new SlotOrganizer();
      const analysis = organizer.analyze(invComp.container, { startSlot: 9, endSlot: 36 });

      const m = analysis.messiness;
      trySendMessage(player,
        `§7混乱度: §f${(m.total * 100).toFixed(0)}% §7(顺序 §e${(m.order * 100).toFixed(0)}% §7堆叠 §e${(m.stack * 100).toFixed(0)}%)`
      );

      if (m.total < 0.05) {
        trySendMessage(player, "§e背包已经很整齐了，无需整理");
        return;
      }

      const applyResult = organizer.apply(invComp.container, analysis);
      if (!applyResult.success) {
        trySendMessage(player, `§c整理失败: ${applyResult.error}`);
        return;
      }

      for (const line of formatOrganizeResult(applyResult, "背包")) {
        trySendMessage(player, line);
      }
    } catch (error) {
      trySendMessage(player, `§c整理失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return success("已提交背包整理请求");
}
