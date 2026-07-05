/**
 * ============================================================================
 * ConfigUI —— 模组全局配置界面
 * ============================================================================
 *
 * 职责：
 * 1. 提供信物配选择界面（下拉选择框）
 * 2. 配置仓库最大尺寸（三轴独立选择）和单仓库最大容器数
 * 3. 仅管理员可访问
 * 4. 配置通过 ModConfigStore 持久化到 DynamicProperty
 * ============================================================================
 */

import { type Player } from "@minecraft/server";
import { ModalFormBuilder } from "./FormHelper";
import type { ModConfigStore } from "../persistence/ModConfigStore";
import { TOKEN_OPTIONS, SIZE_OPTIONS, CONTAINER_OPTIONS } from "../persistence/ModConfigStore";
import { canManageWarehouse } from "../player/PlayerAuth";

/**
 * 显示模组全局配置界面。
 *
 * @param player      - 操作玩家
 * @param configStore - 模组配置仓储
 */
export async function showConfigUI(player: Player, configStore: ModConfigStore): Promise<void> {
  if (!canManageWarehouse(player)) {
    player.sendMessage("§c你没有权限修改模组配置（需要 op）");
    return;
  }

  const config = configStore.load();
  const tokenIdx = TOKEN_OPTIONS.findIndex((o) => o.itemId === config.tokenItemId);
  const sizeIdx = SIZE_OPTIONS.findIndex(
    (o) => o.sizeX === config.maxSizeX && o.sizeY === config.maxSizeY && o.sizeZ === config.maxSizeZ
  );
  const conIdx = CONTAINER_OPTIONS.findIndex((o) => o.value === config.maxContainers);

  const vals = await new ModalFormBuilder()
    .title("SmartWarehouse 配置")
    .label("info", "§7配置模组的全局设置")
    .dropdown("token", "§a选择信物", TOKEN_OPTIONS.map((o) => o.label), { defaultValueIndex: Math.max(0, tokenIdx) })
    .dropdown("size", "§a仓库最大尺寸", SIZE_OPTIONS.map((o) => o.label), { defaultValueIndex: Math.max(0, sizeIdx) })
    .dropdown("containers", "§a单仓库最大容器数", CONTAINER_OPTIONS.map((o) => o.label), { defaultValueIndex: Math.max(0, conIdx) })
    .show(player);

  if (!vals) return;

  const tIdx = vals.token as number;
  const sIdx = vals.size as number;
  const cIdx = vals.containers as number;

  const selToken = TOKEN_OPTIONS[tIdx];
  const selSize = SIZE_OPTIONS[sIdx];
  const selCon = CONTAINER_OPTIONS[cIdx];

  if (selSize && selCon) {
    configStore.save({
      tokenItemId: selToken?.itemId ?? null,
      maxSizeX: selSize.sizeX,
      maxSizeY: selSize.sizeY,
      maxSizeZ: selSize.sizeZ,
      maxContainers: selCon.value,
    });
  }

  if (selToken?.itemId === null) {
    player.sendMessage("§a已关闭信物，手持任何物品均不触发仓库交互");
  } else if (selToken) {
    player.sendMessage(`§a信物已设置为 ${selToken.label}§a，手持该物品即可触发仓库交互`);
  }
  player.sendMessage(
    `§7仓库最大尺寸: ${selSize?.label ?? "16×16×16"}，最大容器数: ${selCon?.label ?? "200"}`
  );
}
