/**
 * 命令参数解析工具。
 *
 * 负责解析和标准化命令输入的参数，
 * 与 Minecraft 命令引擎的参数类型解耦。
 */

import type { WarehouseId } from "../../types";
import { normalizeWarehouseId } from "../../persistence/WarehouseRepository";

type ParseWarehouseIdResult = { ok: true; id: WarehouseId } | { ok: false; message: string };

/**
 * 解析原始字符串为标准化的仓库标识符。
 */
export function parseWarehouseId(raw: string): ParseWarehouseIdResult {
  try {
    return { ok: true, id: normalizeWarehouseId(raw) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无效的仓库名称" };
  }
}

/**
 * 将 Vector3 浮点坐标转换为整型方块坐标。
 */
export function toBlockLocation(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}
