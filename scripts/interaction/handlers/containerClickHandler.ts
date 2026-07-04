/**
 * 容器点击处理器。
 *
 * 玩家手持信物右键点击受支持容器方块时触发。
 * 查找容器所属仓库，显示容器角色设置菜单。
 */

import { world, system } from "@minecraft/server";
import type { Player } from "@minecraft/server"
import type { BlockLocation } from "../../types";
import { isSupportedContainerType } from "../../domain/warehouse/ContainerTypes";
import type { WarehouseService } from "../../infrastructure/minecraft/WarehouseService";
import { showContainerRoleMenu } from "../../ui/ContainerRoleMenu";
import { Logger } from "../../infrastructure/Logger";

const log = new Logger("ContainerClick");

export function handleContainerClick(
  player: Player,
  service: WarehouseService,
  dimensionId: string,
  location: BlockLocation
): void {
  const warehouse = service.findWarehouseAt(dimensionId, location);
  if (!warehouse) {
    player.sendMessage("§c该容器不属于任何仓库");
    return;
  }

  const containerEntry = Object.entries(warehouse.containers).find(([, c]) =>
    c.occupiedLocations.some((l) => l.x === location.x && l.y === location.y && l.z === location.z)
  );

  if (!containerEntry) {
    try {
      const block = world.getDimension(dimensionId).getBlock(location);
      if (block && isSupportedContainerType(block.typeId)) {
        player.sendMessage("§e该容器坐标与记录不一致（可能被活塞移动），正在尝试修复...");
        service.rescanWarehouse(warehouse.id);
        player.sendMessage("§a已触发仓库重扫，容器数据将在下次扫描后更新");
        return;
      }
    } catch { /* 静默 */ }
    player.sendMessage("§c无法找到容器信息（数据可能已过期，可尝试 /sw:rescan 修复）");
    return;
  }

  const [containerId, container] = containerEntry;

  system.run(() => {
    showContainerRoleMenu(player, warehouse, containerId, container, service).catch((error) => {
      log.error(`ContainerRoleMenu error for ${player.name}: ${error}`);
    });
  });
}
