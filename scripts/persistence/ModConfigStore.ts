/**
 * ============================================================================
 * ModConfigStore ââ æ¨¡ç»å¨å±éç½®å­å¨ï¼Dynamic Propertyï¼
 * ============================================================================
 *
 * èè´£ï¼
 * 1. å­å¨æ¨¡ç»çº§å«éç½®ï¼å½åä»ä¿¡ç©ç©å IDï¼
 * 2. ä» DynamicProperty è¯»åï¼åå­ç¼å­
 * 3. æä¾ä¿¡ç©éé¡¹åè¡¨åé»è®¤å¼
 * ============================================================================
 */

import { world } from "@minecraft/server";
import { ITEM_NAME_MAP } from "../data/ItemNameMap";

const CONFIG_KEY = "sw:mod_config";

const DEFAULT_TOKEN = "minecraft:wooden_hoe";

function labelFromMap(typeId: string): string {
  return ITEM_NAME_MAP[typeId] ?? typeId;
}

export const TOKEN_OPTIONS: { label: string; itemId: string | null }[] = [
  { label: "§7关闭 (无信物)", itemId: null },
  { label: `§e${labelFromMap("minecraft:wooden_hoe")} (默认)`, itemId: "minecraft:wooden_hoe" },
  { label: `§a${labelFromMap("minecraft:stick")}`, itemId: "minecraft:stick" },
  { label: `§d${labelFromMap("minecraft:parrot_spawn_egg")}`, itemId: "minecraft:parrot_spawn_egg" },
  { label: `§b${labelFromMap("minecraft:nautilus_shell")}`, itemId: "minecraft:nautilus_shell" },
  { label: `§6${labelFromMap("minecraft:disc_fragment_5")}`, itemId: "minecraft:disc_fragment_5" },
  { label: `§b${labelFromMap("minecraft:nether_star")}`, itemId: "minecraft:nether_star" },
  { label: `§6${labelFromMap("minecraft:blaze_powder")}`, itemId: "minecraft:blaze_powder" },
  { label: `§f${labelFromMap("minecraft:feather")}`, itemId: "minecraft:feather" },
  { label: `§7${labelFromMap("minecraft:flint")}`, itemId: "minecraft:flint" },
  { label: `§6${labelFromMap("minecraft:blaze_rod")}`, itemId: "minecraft:blaze_rod" },
  { label: `§b${labelFromMap("minecraft:breeze_rod")}`, itemId: "minecraft:breeze_rod" },
  { label: `§f${labelFromMap("minecraft:arrow")}`, itemId: "minecraft:arrow" },
];

export interface SizeOption {
  label: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export const SIZE_OPTIONS: SizeOption[] = [
  { label: "16×8×16", sizeX: 16, sizeY: 8, sizeZ: 16 },
  { label: "24×8×24", sizeX: 24, sizeY: 8, sizeZ: 24 },
  { label: "32×8×32 推荐", sizeX: 32, sizeY: 8, sizeZ: 32 },
  { label: "48×8×48", sizeX: 48, sizeY: 8, sizeZ: 48 },
  { label: "64×8×64", sizeX: 64, sizeY: 8, sizeZ: 64 },
  { label: "16×16×16", sizeX: 16, sizeY: 16, sizeZ: 16 },
  { label: "24×16×24", sizeX: 24, sizeY: 16, sizeZ: 24 },
  { label: "32×16×32 推荐", sizeX: 32, sizeY: 16, sizeZ: 32 },
  { label: "48×16×48", sizeX: 48, sizeY: 16, sizeZ: 48 },
  { label: "64×16×64", sizeX: 64, sizeY: 16, sizeZ: 64 },
];

export const CONTAINER_OPTIONS: { label: string; value: number }[] = [
  { label: "50 个容器", value: 50 },
  { label: "100 个容器", value: 100 },
  { label: "200 个容器 推荐", value: 200 },
  { label: "512 个容器", value: 512 },
];

export interface ModConfig {
  tokenItemId: string | null;
  maxSizeX: number;
  maxSizeY: number;
  maxSizeZ: number;
  maxContainers: number;
}

export interface TokenOption {
  label: string;
  itemId: string | null;
}

export class ModConfigStore {
  private cached: ModConfig | null = null;

  load(): ModConfig {
    if (this.cached) return this.cached;

    const raw = world.getDynamicProperty(CONFIG_KEY);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as Partial<ModConfig>;
        this.cached = {
          tokenItemId: parsed.tokenItemId ?? DEFAULT_TOKEN,
          maxSizeX: parsed.maxSizeX ?? 16,
          maxSizeY: parsed.maxSizeY ?? 16,
          maxSizeZ: parsed.maxSizeZ ?? 16,
          maxContainers: parsed.maxContainers ?? 50,
        };
        return this.cached;
      } catch {
      }
    }

    this.cached = { tokenItemId: DEFAULT_TOKEN, maxSizeX: 16, maxSizeY: 16, maxSizeZ: 16, maxContainers: 50 };
    return this.cached;
  }

  save(config: ModConfig): void {
    this.cached = { ...config };
    world.setDynamicProperty(CONFIG_KEY, JSON.stringify(this.cached));
  }

  getTokenId(): string | null {
    return this.load().tokenItemId;
  }

  setTokenId(itemId: string | null): void {
    const config = this.load();
    this.save({ ...config, tokenItemId: itemId });
  }

  isToken(heldTypeId: string | undefined): boolean {
    const tokenId = this.getTokenId();
    if (tokenId === null) return false;
    return heldTypeId === tokenId;
  }

  getMaxVolume(): number {
    const c = this.load();
    return c.maxSizeX * c.maxSizeY * c.maxSizeZ;
  }

  getMaxContainers(): number { return this.load().maxContainers; }

  invalidateCache(): void {
    this.cached = null;
  }
}
