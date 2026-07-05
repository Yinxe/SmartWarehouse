/**
 * JSON 安全解析工具 —— 领域层。
 *
 * 纯字符串运算，不依赖任何 Minecraft 运行时 API。
 */

/**
 * 安全解析 JSON 字符串为对象。
 * 如果输入为空或解析失败，返回 fallback 默认值。
 * 同时确保解析结果是普通对象（非数组）。
 */
export function parseJsonObject<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * 将任意值序列化为 JSON 字符串。
 */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 获取字符串的 UTF-16 长度。
 * Minecraft Dynamic Property 的存储预算按 UTF-16 code units 计算。
 */
export function getUtf16Length(value: string): number {
  return value.length;
}
