/**
 * Minecraft Script API 的 Vitest 模拟模块。
 *
 * 在测试环境中替换 @minecraft/server，避免直接依赖 Minecraft 运行时。
 * 通过 vitest.config.ts 中的 resolve.alias 配置生效。
 */

export class ItemStack {
  readonly maxAmount = 64;

  constructor(
    readonly typeId: string,
    public amount: number
  ) {}

  clone(): ItemStack {
    return new ItemStack(this.typeId, this.amount);
  }
}

export class Container {}
export class Player {}
export class Dimension {}
export class Block {}
export class BlockPermutation {}
export class BlockComponent {}
export class World {}

export const system = {
  currentTick: 0,
  run(callback: () => void): number {
    callback();
    return 0;
  },
  runInterval(): number {
    return 0;
  },
  runTimeout(callback: () => void): number {
    callback();
    return 0;
  },
  clearRun(): void {
    return undefined;
  },
};

export const world = {
  getDimension(): never {
    throw new Error("测试环境不允许直接访问 world.getDimension");
  },
  getPlayers(): Player[] {
    return [];
  },
  getDynamicProperty(): undefined {
    return undefined;
  },
  setDynamicProperty(): void {
    return undefined;
  },
};

export const GameMode = { survival: 0, creative: 1, adventure: 2, spectator: 3 };
export const PlayerPermissionLevel = { visitor: 0, member: 1, operator: 2, custom: 3 };
