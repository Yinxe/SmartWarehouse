/**
 * 非容器方块点击处理器。
 *
 * 玩家手持信物右键点击非容器方块时触发。
 * 用于仓库创建/调整大小的区域选择流程。
 */

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server"
import type { BlockLocation } from "../types";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { getSession, setSession, clearSession } from "./SelectionSessionStore";

export function handleNonContainerClick(
  player: Player,
  service: WarehouseService,
  dimensionId: string,
  location: BlockLocation
): void {
  const session = getSession(player);

  if (!session) {
    player.sendMessage("§e请先手持信物对空右键打开菜单创建仓库");
    return;
  }

  if (!session.pointA) {
    setSession(player, { ...session, pointA: location });
    player.sendMessage(`§a已标记第一个点 (${location.x}, ${location.y}, ${location.z})，请标记第二个对角点`);
    return;
  }

  const pointA = session.pointA;
  const pointB = location;

  if (session.type === "createWarehouse") {
    const { warehouseName, defaultNewContainerRole, defaultNewContainerEnabled } = session;
    clearSession(player);

    system.runTimeout(() => {
      try {
        const result = service.createWarehouse(
          warehouseName, dimensionId, pointA, pointB,
          defaultNewContainerRole, defaultNewContainerEnabled, player.id
        );
        player.sendMessage(`§a仓库 "${result.displayName}" 创建成功！共发现 ${Object.keys(result.containers).length} 个容器`);
      } catch (error) {
        player.sendMessage(`§c操作失败: ${error}，请重新开始`);
      }
    }, 1);
  } else if (session.type === "resizeWarehouse") {
    const { warehouseId } = session;
    clearSession(player);

    system.runTimeout(() => {
      try {
        const result = service.resizeWarehouse(warehouseId, pointA, pointB);
        player.sendMessage(`§a仓库 "${result.displayName}" 调整成功！共发现 ${Object.keys(result.containers).length} 个容器`);
      } catch (error) {
        player.sendMessage(`§c操作失败: ${error}，请重新开始`);
      }
    }, 1);
  } else {
    clearSession(player);
  }
}
