/**
 * 命令层权限与玩家校验器。
 *
 * 从命令发起者中提取玩家对象并进行权限校验，
 * 与 Minecraft 命令引擎的 CustomCommandOrigin 解耦。
 */

import { CommandPermissionLevel, Player, CustomCommandStatus, type CustomCommandOrigin } from "@minecraft/server";
import type { CustomCommandResult } from "@minecraft/server";
import { canManageWarehouse } from "../../player/PlayerAuth";
import { Logger } from "../../util/Logger";

const log = new Logger("CommandValidator");

/** 校验结果类型：ok 时携带 Player，失败时携带错误消息 */
type PlayerResult = { ok: true; player: Player } | { ok: false; message: string };

/**
 * 从命令发起者中提取玩家对象。
 * 仅校验是否为玩家，不校验 op 权限。
 * 用于 sw:organize、sw:menu 等所有玩家均可使用的命令。
 */
export function parseAnyPlayer(origin: CustomCommandOrigin): PlayerResult {
  const entity = origin.sourceEntity ?? origin.initiator;
  if (!(entity instanceof Player)) return { ok: false, message: "该命令只能由玩家执行" };
  return { ok: true, player: entity };
}

/**
 * 从命令发起者中提取玩家对象并进行 op 权限校验。
 * 用于 sw:create、sw:delete 等管理命令。
 */
export function parseCommandPlayer(origin: CustomCommandOrigin): PlayerResult {
  const entity = origin.sourceEntity ?? origin.initiator;
  if (!(entity instanceof Player)) return { ok: false, message: "该命令只能由玩家执行" };
  if (!canManageWarehouse(entity)) {
    return { ok: false, message: "你没有权限执行仓库管理命令（需要 op 标签：/tag @s add op）" };
  }
  return { ok: true, player: entity };
}

/**
 * 安全地向指定玩家发送消息。
 * 玩家可能在异步回调中断线，捕获异常静默忽略。
 */
export function trySendMessage(player: Player, message: string): void {
  try {
    player.sendMessage(message);
  } catch {
    // 玩家可能在命令回调与异步 system.run 执行之间断线
  }
}

/**
 * 构造成功命令结果。
 */
export function success(message: string): CustomCommandResult {
  return { status: CustomCommandStatus.Success, message };
}

/**
 * 构造失败命令结果。
 */
export function failure(message: string): CustomCommandResult {
  return { status: CustomCommandStatus.Failure, message };
}
