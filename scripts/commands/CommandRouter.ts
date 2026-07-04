/**
 * ============================================================================
 * CommandRouter —— SmartWarehouse 命令路由层（瘦路由）
 * ============================================================================
 *
 * 职责：
 * 1. 在 Minecraft startup 事件中注册所有自定义命令
 * 2. 将命令路由到对应的 Handler 处理
 * 3. 不包含任何业务逻辑——仅做路由
 *
 * 权限校验和参数解析委托给 validators/ 下的工具函数，
 * 命令执行委托给 handlers/ 下的处理器。
 * ============================================================================
 */

import {
  system,
  CustomCommandParamType,
  type Vector3,
  type CustomCommandOrigin,
} from "@minecraft/server";
import type { CustomCommand } from "@minecraft/server";
import { SlotOrganizer } from "../infrastructure/minecraft/container/SlotOrganizer";
import type { WarehouseRepository } from "../infrastructure/persistence/WarehouseRepository";
import type { ModConfigStore } from "../infrastructure/persistence/ModConfigStore";
import { Logger } from "../infrastructure/Logger";
import type { WarehouseService } from "../infrastructure/minecraft/WarehouseService";
import { WarehouseHandlers } from "./handlers/WarehouseHandlers";
import { handleOrganize } from "./handlers/OrganizeHandler";
import { handleMenu } from "./handlers/MenuHandler";
import { handleSearch } from "./handlers/SearchHandler";

const log = new Logger("CommandRouter");

/**
 * 构建命令基础配置（所有命令的公共字段）。
 */
function commandBase(name: string, description: string): Omit<CustomCommand, "mandatoryParameters"> {
  return {
    name,
    description,
    permissionLevel: 0, // CommandPermissionLevel.Any
    cheatsRequired: false,
  };
}

/**
 * 构建"区域型"命令配置（仓库名称 + 两组坐标）。
 */
function regionCommand(name: string, description: string): CustomCommand {
  return {
    ...commandBase(name, description),
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
      { name: "pos1", type: CustomCommandParamType.Location },
      { name: "pos2", type: CustomCommandParamType.Location },
    ],
  };
}

/**
 * 构建"名称型"命令配置（仅仓库名称）。
 */
function namedCommand(name: string, description: string): CustomCommand {
  return {
    ...commandBase(name, description),
    mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
  };
}

/**
 * 命令路由 —— 注册命令并委托给 Handler。
 */
export class CommandRouter {
  private registered = false;

  constructor(
    private readonly service: WarehouseService,
    private readonly repository: WarehouseRepository,
    private readonly configStore: ModConfigStore
  ) {}

  register(): void {
    if (this.registered) return;
    this.registered = true;

    const h = new WarehouseHandlers(this.service);

    system.beforeEvents.startup.subscribe((event) => {
      // sw:create —— 创建仓库
      event.customCommandRegistry.registerCommand(
        regionCommand("sw:create", "创建 SmartWarehouse 仓库"),
        (origin, name: string, pos1: Vector3, pos2: Vector3) => h.handleCreate(origin, name, pos1, pos2)
      );

      // sw:resize —— 调整仓库区域
      event.customCommandRegistry.registerCommand(
        regionCommand("sw:resize", "调整 SmartWarehouse 仓库区域"),
        (origin, name: string, pos1: Vector3, pos2: Vector3) => h.handleResize(origin, name, pos1, pos2)
      );

      // sw:rescan —— 重新扫描仓库容器
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:rescan", "重新扫描 SmartWarehouse 仓库容器"),
        (origin, name: string) => h.handleRescan(origin, name)
      );

      // sw:delete —— 删除仓库
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:delete", "删除 SmartWarehouse 仓库"),
        (origin, name: string) => h.handleDelete(origin, name)
      );

      // sw:rescan_preview —— 预览重新扫描结果
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:rescan_preview", "预览 SmartWarehouse 仓库容器变更"),
        (origin, name: string) => h.handleRescanPreview(origin, name)
      );

      // sw:organize —— 整理玩家背包
      event.customCommandRegistry.registerCommand(
        { ...commandBase("sw:organize", "整理玩家背包物品"), mandatoryParameters: [] },
        (origin) => handleOrganize(origin)
      );

      // sw:menu —— 打开主菜单
      event.customCommandRegistry.registerCommand(
        { ...commandBase("sw:menu", "打开 SmartWarehouse 主菜单"), mandatoryParameters: [] },
        (origin) => handleMenu(origin, this.repository, this.service, this.configStore)
      );

      // sw:search —— 在附近仓库搜索物品
      event.customCommandRegistry.registerCommand(
        namedCommand("sw:search", "在附近仓库搜索物品"),
        (origin, query: string) => handleSearch(origin, query, this.repository)
      );

      log.info("Custom commands registered (sw:create/sw:resize/sw:rescan/sw:delete/sw:rescan_preview/sw:organize/sw:menu/sw:search)");
    });
  }
}
