/**
 * 主菜单命令处理器。
 *
 * 处理 sw:menu 命令，打开 SmartWarehouse 主菜单。
 */

import { system, type CustomCommandOrigin } from "@minecraft/server";
import { showMainMenu } from "../../ui/MainMenu";
import type { WarehouseService } from "../../infrastructure/minecraft/WarehouseService";
import type { WarehouseRepository } from "../../infrastructure/persistence/WarehouseRepository";
import type { ModConfigStore } from "../../infrastructure/persistence/ModConfigStore";
import { parseAnyPlayer, success, failure } from "../validators/PermissionValidator";
import { Logger } from "../../infrastructure/Logger";

const log = new Logger("MenuHandler");

/**
 * 打开 SmartWarehouse 主菜单。
 */
export function handleMenu(
  origin: CustomCommandOrigin,
  repository: WarehouseRepository,
  service: WarehouseService,
  configStore: ModConfigStore
) {
  const result = parseAnyPlayer(origin);
  if (!result.ok) return failure(result.message);

  system.runTimeout(() => {
    showMainMenu(result.player, repository, service, configStore).catch((error) => {
      log.error(`MainMenu error for ${result.player.name}: ${error}`);
    });
  });

  return success("已打开 SmartWarehouse 主菜单");
}
