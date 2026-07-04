import { world } from "@minecraft/server";
import { getUtf16Length, parseJsonObject, stringifyJson } from "../../domain/shared/Json";

export const DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH = 24_000;

export class DynamicPropertyStore {
  constructor(private readonly maxStringLength = DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH) {}

  getJson<T>(key: string, fallback: T): T {
    const value = world.getDynamicProperty(key);
    return parseJsonObject(typeof value === "string" ? value : undefined, fallback);
  }

  setJson(key: string, value: unknown): void {
    const raw = stringifyJson(value);
    if (getUtf16Length(raw) > this.maxStringLength) {
      throw new Error(`动态属性 ${key} 大小超限：${getUtf16Length(raw)} > ${this.maxStringLength}`);
    }
    world.setDynamicProperty(key, raw);
  }

  delete(key: string): void {
    world.setDynamicProperty(key, undefined);
  }
}
