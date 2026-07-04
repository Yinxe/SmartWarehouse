/**
 * JSON 安全解析工具。
 *
 * 实现已迁移到 Domain 层，此文件保持为转发 re-export 以确保现有导入不受影响。
 */
export { parseJsonObject, stringifyJson, getUtf16Length } from "../domain/shared/Json";
