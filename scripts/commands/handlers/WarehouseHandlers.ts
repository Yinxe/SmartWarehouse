/**
 * 仓库管理命令处理器。
 *
 * 处理 sw:create、sw:resize、sw:rescan、sw:rescan_preview、sw:delete 命令。
 * 每个 Handler 接收解析后的参数，调用基础设施层服务执行业务操作。
 */

import { system, type Vector3, type CustomCommandOrigin } from "@minecraft/server";
import type { WarehouseService } from "../../warehouse/WarehouseService";
import { parseCommandPlayer, trySendMessage, success, failure } from "../validators/PermissionValidator";
import { parseWarehouseId, toBlockLocation } from "../validators/ParameterParser";

/**
 * 仓库管理命令处理器。
 * 所有方法都接收原始命令参数，返回 CustomCommandResult。
 */
export class WarehouseHandlers {
  constructor(private readonly service: WarehouseService) {}

  /** sw:create —— 创建仓库 */
  handleCreate(origin: CustomCommandOrigin, name: string, pos1: Vector3, pos2: Vector3) {
    const result = parseCommandPlayer(origin);
    if (!result.ok) return failure(result.message);
    const { player } = result;

    const normalized = parseWarehouseId(name);
    if (!normalized.ok) return failure(normalized.message);

    const dimensionId = player.dimension.id;
    const pointA = toBlockLocation(pos1);
    const pointB = toBlockLocation(pos2);

    system.runTimeout(() => {
      try {
        const warehouse = this.service.createWarehouse(normalized.id, dimensionId, pointA, pointB, "misc", true, player.id);
        trySendMessage(player, `§a仓库 "${warehouse.displayName}" 创建成功！共发现 ${Object.keys(warehouse.containers).length} 个容器`);
      } catch (error) {
        trySendMessage(player, `§c创建失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return success(`已提交仓库创建请求: ${name}`);
  }

  /** sw:resize —— 调整仓库区域 */
  handleResize(origin: CustomCommandOrigin, name: string, pos1: Vector3, pos2: Vector3) {
    const result = parseCommandPlayer(origin);
    if (!result.ok) return failure(result.message);
    const { player } = result;

    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    const pointA = toBlockLocation(pos1);
    const pointB = toBlockLocation(pos2);

    system.runTimeout(() => {
      try {
        const warehouse = this.service.resizeWarehouse(parsed.id, pointA, pointB);
        trySendMessage(player, `§a仓库 "${warehouse.displayName}" 调整成功！共发现 ${Object.keys(warehouse.containers).length} 个容器`);
      } catch (error) {
        trySendMessage(player, `§c调整失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return success(`已提交仓库调整请求: ${name}`);
  }

  /** sw:rescan —— 重新扫描仓库容器 */
  handleRescan(origin: CustomCommandOrigin, name: string) {
    const result = parseCommandPlayer(origin);
    if (!result.ok) return failure(result.message);
    const { player } = result;

    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    system.runTimeout(() => {
      try {
        const warehouse = this.service.rescanWarehouse(parsed.id);
        trySendMessage(player, `§a仓库 "${warehouse.displayName}" 重新扫描完成！共发现 ${Object.keys(warehouse.containers).length} 个容器`);
      } catch (error) {
        trySendMessage(player, `§c重新扫描失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return success(`已提交重新扫描请求: ${name}`);
  }

  /** sw:rescan_preview —— 预览重扫结果 */
  handleRescanPreview(origin: CustomCommandOrigin, name: string) {
    const result = parseCommandPlayer(origin);
    if (!result.ok) return failure(result.message);
    const { player } = result;

    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    system.runTimeout(() => {
      try {
        const diff = this.service.previewRescanWarehouse(parsed.id);
        trySendMessage(player,
          `§7[预览] 仓库 "${parsed.id}" 重扫变更：新增 §a${diff.added.length}§7，移除 §c${diff.removed.length}§7，变化 §e${diff.changed.length}§7，未变 §f${diff.unchanged.length}`
        );
      } catch (error) {
        trySendMessage(player, `§c预览失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return success(`已提交预览请求: ${name}`);
  }

  /** sw:delete —— 删除仓库 */
  handleDelete(origin: CustomCommandOrigin, name: string) {
    const result = parseCommandPlayer(origin);
    if (!result.ok) return failure(result.message);
    const { player } = result;

    const parsed = parseWarehouseId(name);
    if (!parsed.ok) return failure(parsed.message);

    system.runTimeout(() => {
      try {
        this.service.deleteWarehouse(parsed.id);
        trySendMessage(player, `§a仓库 ${parsed.id} 已删除`);
      } catch (error) {
        trySendMessage(player, `§c删除失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return success(`已提交仓库删除请求: ${name}`);
  }
}
