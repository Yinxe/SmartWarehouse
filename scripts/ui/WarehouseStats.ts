/**
 * 仓库统计 UI 格式化。
 *
 * 统计计算和缓存逻辑已迁移到 warehouse/WarehouseStatsService.ts，
 * 此文件仅保留格式化显示相关函数。
 */

import { Table, Cell } from "./Table";
import { CAPACITY_WARNING_THRESHOLD } from "../sorting/algorithm/CapacityWarning";
import type { WarehouseStats, RoleStats } from "../warehouse/WarehouseStatsService";

// 为兼容旧导入路径重新导出基础函数
export { CAPACITY_WARNING_THRESHOLD } from "../sorting/algorithm/CapacityWarning";
export {
  setContainerStats,
  invalidateWarehouseStats,
  getOrComputeContainerStats,
  refreshContainerStats,
  getWarehouseStats,
  isContainerNearFull,
  isContainerFull,
} from "../warehouse/WarehouseStatsService";
export type { WarehouseStats, RoleStats } from "../warehouse/WarehouseStatsService";

// ─── 格式化函数 ─────────────────────────────────────────────────

/**
 * 将仓库统计格式化为表格式文本（用于 ModalForm label）。
 *
 *   仓库 : my_base
 *   <>           TYPES  ITEMS    STORAGE
 *   Container(8) 52     4250223  135/384(0.35)  ⚠
 *   Bulk(1)      1      3000     10/54(0.19)
 *   Normal(5)    12     1200     80/216(0.37)
 *   Misc(1)      8      50       45/114(0.39)   ⚠
 *   Input(10)    0      0        0/20(0.00)
 *   Family:54
 */
export function formatWarehouseStats(stats: WarehouseStats): string {
  const uc = (p: number) => p >= 100 ? "§c" : p >= 80 ? "§e" : p >= 50 ? "§6" : "§a";
  const warnThreshold = CAPACITY_WARNING_THRESHOLD * 100;
  const tbl = new Table();

  tbl.header(Cell.left("<>"), Cell.right("TYPES"), Cell.right("ITEMS"), Cell.left("STORAGE"));

  const totPct = stats.totalSlots > 0 ? Math.round((stats.usedSlots / stats.totalSlots) * 100) : 0;
  const totRatio = `(${(totPct / 100).toFixed(2)})`;
  const totWarn = stats.totalSlots > 0 && totPct >= warnThreshold ? ` §e⚠` : "";
  tbl.row(
    `§eContainer(${stats.containerCount})`,
    Cell.right(String(stats.uniqueTypes)),
    Cell.right(String(stats.totalItems)),
    Cell.left(`§e${stats.usedSlots}§7/§e${stats.totalSlots}§7${uc(totPct)}${totRatio}§7${totWarn}`)
  );

  const defs: { r: string; c: string; l: string }[] = [
    { r: "bulk", c: "§b", l: "Bulk" }, { r: "normal", c: "§a", l: "Normal" },
    { r: "misc", c: "§d", l: "Misc" }, { r: "input", c: "§6", l: "Input" },
  ];
  for (const { r, c, l } of defs) {
    const rs = stats.byRole[r];
    if (!rs) continue;
    const p = rs.totalSlots > 0 ? Math.round((rs.usedSlots / rs.totalSlots) * 100) : 0;
    const ratio = `(${(p / 100).toFixed(2)})`;
    const warn = rs.totalSlots > 0 && p >= warnThreshold ? ` ${c}⚠` : "";
    tbl.row(
      `${c}${l}(${rs.containerCount})`,
      Cell.right(String(rs.uniqueTypes)),
      Cell.right(String(rs.totalItems)),
      Cell.left(`${c}${rs.usedSlots}§7/${c}${rs.totalSlots}§7${uc(p)}${ratio}§7${warn}`
    ));
  }

  const lines = [`§7仓库 : ${stats.displayName}`, tbl.render(0, [1, 1, 3])];
  if (stats.enabledFamiliesCount > 0) lines.push(` §bFamily:${stats.enabledFamiliesCount}`);
  return lines.join("\n");
}

/**
 * 格式化容器容量信息（单行，用于容器设置页 label）。
 * 格式：容量: 29/54[30%]  1856 items  27 types
 */
export function formatContainerCapacityLine(
  usedSlots: number,
  totalSlots: number,
  totalItems: number,
  uniqueTypes: number
): string {
  const usage = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
  const usageColor = getUsageColor(usage);
  const warn = usage >= CAPACITY_WARNING_THRESHOLD * 100 ? ` ${usageColor}⚠` : "";
  return `§7容量: §f${usedSlots}§7/§f${totalSlots}§7[${usageColor}${usage}%§7]  §f${formatNumber(totalItems)}§7 items  §f${uniqueTypes}§7 types${warn}`;
}

function getUsageColor(percent: number): string {
  if (percent >= 100) return "§c";
  if (percent >= 80) return "§e";
  if (percent >= 50) return "§6";
  return "§a";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
