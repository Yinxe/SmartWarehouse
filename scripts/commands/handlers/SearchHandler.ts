/**
 * 物品搜索命令处理器。
 *
 * 处理 sw:search 命令，在附近且属于该玩家的仓库中搜索物品。
 */

import { world, system, type CustomCommandOrigin } from "@minecraft/server";
import { SearchService, formatSearchResult } from "../../infrastructure/minecraft/SearchService";
import type { WarehouseRepository } from "../../infrastructure/persistence/WarehouseRepository";
import { canManageWarehouse } from "../../infrastructure/PlayerAuth";
import { isNearAreaXZ } from "../../domain/shared/Vector";
import { parseCommandPlayer, trySendMessage, success, failure } from "../validators/PermissionValidator";
import { parseWarehouseId } from "../validators/ParameterParser";
import type { Player } from "@minecraft/server";
import type { WarehouseArea } from "../../types";

/**
 * 执行物品搜索。
 */
export function handleSearch(origin: CustomCommandOrigin, query: string, repository: WarehouseRepository) {
  const result = parseCommandPlayer(origin);
  if (!result.ok) return failure(result.message);
  const { player } = result;

  // 查找附近且属于该玩家的仓库
  const warehouses = repository.loadAll();
  const isAdmin = canManageWarehouse(player);
  const nearbyOwned = warehouses.filter((w) => {
    if (w.dimensionId !== player.dimension.id) return false;
    if (w.ownerId !== player.id && !isAdmin) return false;
    if (!isNearAreaXZ({ x: player.location.x, z: player.location.z }, w.area, 8)) return false;
    return true;
  });

  if (nearbyOwned.length === 0) {
    return failure("附近没有找到属于你的仓库");
  }

  // 取最近的仓库
  nearbyOwned.sort((a, b) => distToCenter(player, a.area) - distToCenter(player, b.area));
  const target = nearbyOwned[0];

  system.runTimeout(() => {
    try {
      const dimension = world.getDimension(target.dimensionId);
      const searchService = new SearchService();
      const searchResult = searchService.search(target, query, dimension);
      for (const line of formatSearchResult(searchResult)) {
        trySendMessage(player, line);
      }
    } catch (error) {
      trySendMessage(player, `§c搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return success(`正在仓库 "${target.displayName}" 中搜索: ${query}`);
}

/** 计算玩家到区域中心的 XZ 平面距离 */
function distToCenter(player: Player, area: WarehouseArea): number {
  const cx = (area.min.x + area.max.x) / 2;
  const cz = (area.min.z + area.max.z) / 2;
  const dx = player.location.x - cx;
  const dz = player.location.z - cz;
  return Math.sqrt(dx * dx + dz * dz);
}
