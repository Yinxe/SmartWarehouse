# SmartWarehouse DDD Rewrite Phase 2 Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DDD + Hexagonal skeleton directory structure, port interfaces, boundary tests, and minimal infrastructure stubs — without switching the runtime entry point or modifying existing production behavior.

**Architecture:** Domain layer (value objects and rules), Application layer (use cases and port interfaces), Infrastructure layer (Minecraft adapters), Interfaces layer (commands/UI/bootstrap). Current `scripts/main.ts`, `WarehouseService`, `SorterEngine` continue running unchanged.

**Tech Stack:** TypeScript strict mode, Vitest, mocked `@minecraft/server`.

---

## File Structure

```
scripts/
  domain/
    shared/
      errors.ts             基础领域错误类型（Result 模式）
      identifiers.ts        共享值对象（WarehouseId, ContainerId, DimensionId, BlockLocation, WarehouseArea）
    sorting/
      SortingPolicy.ts      路由优先级策略（纯函数，不碰 MC API）
      types.ts              分拣领域类型（RouteLevel, CandidateState, RoutePlan)
    inventory/
      types.ts              库存领域类型（SlotSnapshot, ItemStackView)
  application/
    ports/
      ContainerAccessPort.ts  容器读写端口
      WorldAccessPort.ts      世界/方块/维度访问端口
      WarehouseRepositoryPort.ts 仓库持久化端口
      RuntimeRegistryPort.ts  运行时索引端口
      StatsPort.ts            统计端口
      NotifierPort.ts         玩家通知端口
      EffectPort.ts           视觉/粒子端口
      SchedulerPort.ts        调度器端口
    warehouse/
      CreateWarehouseUseCase.ts
    sorting/
      MoveInputStackUseCase.ts  （骨架）
  infrastructure/
    minecraft/
      SafeMinecraftAccess.ts    safe try-catch helper
    persistence/
      (保留现有文件不变, 后续迁移)
  interfaces/
    bootstrap/
      (main.ts 不变)
```

---

## Task 1: Domain Shared Types and Errors

**Files:**
- Create: `scripts/domain/shared/errors.ts`
- Create: `scripts/domain/shared/identifiers.ts`

- [ ] **Step 1: Create `identifiers.ts`**

```typescript
/**
 * 领域层共享值对象。
 *
 * 这些类型在 Domain 中直接使用，不依赖 Minecraft 运行时 API。
 * BlockLocation 使用整数方块坐标，与 Vector3（浮点数）区分。
 */

/** 维度 ID，如 "minecraft:overworld" */
export type DimensionId = string;

/** 仓库唯一标识符 */
export type WarehouseId = string;

/** 容器唯一标识符 */
export type ContainerId = string;

/** 方块整数坐标 */
export interface BlockLocation {
  x: number;
  y: number;
  z: number;
}

/** 仓库区域，min/max 经过归一化 */
export interface WarehouseArea {
  min: BlockLocation;
  max: BlockLocation;
}

/** 容器角色 */
export type ContainerRole = "normal" | "misc" | "bulk" | "input";

/** 处理速度（游戏刻间隔） */
export type ProcessingSpeed = 4 | 8 | 16 | 20;
```

- [ ] **Step 2: Create `errors.ts`**

```typescript
/**
 * 领域层基础错误与 Result 模式。
 *
 * Domain 方法不抛异常，而是返回 Result 以便 Application 层处理恢复策略。
 */

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<E = string>(error: E): Result<never, E> {
  return { ok: false, error };
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
```

- [ ] **Step 3: Add boundary test**

Create `tests/domain/BoundaryTest.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { WarehouseId, ContainerId, DimensionId, BlockLocation } from "../../scripts/domain/shared/identifiers";

describe("Domain shared types", () => {
  it("can be used without any Minecraft runtime dependency", () => {
    const wid: WarehouseId = "main";
    const cid: ContainerId = "overworld|0|64|0";
    const did: DimensionId = "minecraft:overworld";
    const loc: BlockLocation = { x: 0, y: 64, z: 0 };

    expect(wid).toBe("main");
    expect(cid).toContain("overworld");
    expect(did).toBe("minecraft:overworld");
    expect(loc.x).toBe(0);
  });
});
```

- [ ] **Step 4: Run test**

```bash
npm run test:domain
```

Expected: all previous golden tests pass, plus new boundary test passes.

---

## Task 2: Port Interfaces

**Files:**
- Create: `scripts/application/ports/ContainerAccessPort.ts`
- Create: `scripts/application/ports/WorldAccessPort.ts`
- Create: `scripts/application/ports/WarehouseRepositoryPort.ts`
- Create: `scripts/application/ports/RuntimeRegistryPort.ts`
- Create: `scripts/application/ports/StatsPort.ts`
- Create: `scripts/application/ports/NotifierPort.ts`
- Create: `scripts/application/ports/EffectPort.ts`
- Create: `scripts/application/ports/SchedulerPort.ts`

- [ ] **Step 1: Create ContainerAccessPort**

```typescript
/**
 * 容器访问端口。
 *
 * 定义 Application 层读取和写入 Minecraft 容器的接口。
 * Domain 层禁止直接使用此端口；Domain 只能接收已解析的数据。
 * 所有方法可能因区块未加载、世界边界等运行时原因失败，
 * 实现必须处理这些异常并返回 Result 或 undefined。
 */

import type { ItemStack } from "@minecraft/server";
import type { Result } from "../../domain/shared/errors";

/** 容器运行时引用（不透明句柄，Domain 不使用） */
export interface ContainerHandle {
  readonly size: number;
  readonly emptySlotsCount: number;
}

/** 容器快照（ItemStack 克隆，允许进入 Domain） */
export interface SlotView {
  slot: number;
  item?: ItemStack;
}

export interface ContainerAccessPort {
  /** 根据容器 ID 和存储记录获取运行时容器句柄 */
  getHandle(stored: unknown): ContainerHandle | undefined;

  /** 快照指定范围的槽位 */
  snapshot(handle: ContainerHandle, startSlot?: number, endSlot?: number): SlotView[];

  /** 尝试将物品堆放入容器，返回剩余 */
  addItem(handle: ContainerHandle, stack: ItemStack): ItemStack | undefined;

  /** 设置槽位物品 */
  setSlot(handle: ContainerHandle, slot: number, stack?: ItemStack): Result<void>;

  /** 从快照恢复容器状态 */
  restore(handle: ContainerHandle, snapshot: SlotView[]): Result<void>;
}
```

- [ ] **Step 2: Create WorldAccessPort**

```typescript
/**
 * 世界访问端口。
 *
 * 封装 Minecraft world/dimension/block 的获取操作。
 * 所有方法必须捕获未加载区块、坐标越界等异常并返回 undefined。
 */

import type { BlockLocation, DimensionId, WarehouseArea } from "../../domain/shared/identifiers";

export interface ContainerBlockInfo {
  typeId: string;
  occupiedLocations: BlockLocation[];
  isHopper: boolean;
  isDoubleChest: boolean;
}

export interface WorldAccessPort {
  /** 安全获取维度，失败返回 undefined */
  getDimension(dimensionId: DimensionId): unknown | undefined;

  /** 获取方块类型和容器占用坐标 */
  getContainerBlockInfo(
    dimensionId: DimensionId,
    location: BlockLocation
  ): ContainerBlockInfo | undefined;

  /** 扫描区域内所有容器方块 */
  scanArea(
    dimensionId: DimensionId,
    area: WarehouseArea
  ): Record<string, ContainerBlockInfo>;

  /** 检查坐标所在区块是否已加载 */
  isAreaLoaded(dimensionId: DimensionId, area: WarehouseArea): boolean;

  /** 安全获取方块 */
  tryGetBlock(dimensionId: DimensionId, location: BlockLocation): unknown | undefined;
}
```

- [ ] **Step 3: Create WarehouseRepositoryPort**

```typescript
/**
 * 仓库持久化端口。
 *
 * 定义仓库数据的读写接口，实现与 Dynamic Property 细节解耦。
 * 方法名反映业务语义而非存储机制。
 * 持久化 DTO 不允许包含 ItemStack/Container/Block/Dimension/Player。
 */

import type { WarehouseId, WarehouseArea, ContainerRole, BlockLocation } from "../../domain/shared/identifiers";

export interface WarehouseSettingsDto {
  defaultNewContainerRole: ContainerRole;
  defaultNewContainerEnabled: boolean;
  autoCreateCategories: boolean;
  enabled: boolean;
  processingSpeed: number;
  debug: boolean;
  showBoundary: boolean;
  autoSortThreshold: number;
  enabledFamilies: string[];
  capacityWarning: boolean;
}

export interface StoredContainerDto {
  id: string;
  dimensionId: string;
  primaryLocation: BlockLocation;
  occupiedLocations: BlockLocation[];
  role: ContainerRole;
  enabled: boolean;
  discoveredAt: number;
  updatedAt: number;
}

export interface WarehouseMetaDto {
  version: number;
  id: string;
  displayName: string;
  dimensionId: string;
  area: WarehouseArea;
  ownerId: string;
  settings: WarehouseSettingsDto;
  containerShardCount: number;
  containerCount: number;
  containerShardGeneration: number;
}

export interface WarehouseRepositoryPort {
  /** 加载完整仓库（含所有容器分片） */
  load(id: string): WarehouseMetaDto & { containers: Record<string, StoredContainerDto> } | undefined;

  /** 加载所有仓库的元数据+容器 */
  loadAll(): (WarehouseMetaDto & { containers: Record<string, StoredContainerDto> })[];

  /** 仓库是否存在 */
  exists(id: string): boolean;

  /** 创建仓库 */
  save(data: WarehouseMetaDto & { containers: Record<string, StoredContainerDto> }): void;

  /** 仅更新元数据 */
  saveMetaOnly(data: WarehouseMetaDto): void;

  /** 增量更新容器数据 */
  patchContainers(id: string, containers: Record<string, StoredContainerDto>): void;

  /** 删除仓库 */
  delete(id: string): void;
}
```

- [ ] **Step 4: Create RuntimeRegistryPort**

```typescript
/**
 * 运行时索引端口。
 *
 * 管理内存中的仓库运行时模型缓存。
 * 运行时索引不持久化，重启后冷启动重建。
 */

export interface RuntimeRegistryPort {
  markDirty(warehouseId: string): void;
  delete(warehouseId: string): void;
  resetCursor(warehouseId: string): void;
}
```

- [ ] **Step 5: Create StatsPort**

```typescript
/**
 * 仓库统计端口。
 *
 * 统计数据派生自容器槽位状态，允许清空重建。
 */

export interface ContainerStatsDto {
  containerId: string;
  blockType: string;
  role: string;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;
}

export interface StatsPort {
  getOrCompute(warehouseId: string, containerId: string): ContainerStatsDto | undefined;
  refresh(warehouseId: string, containerId: string): ContainerStatsDto | undefined;
  invalidate(warehouseId: string, containerIds?: string[]): void;
}
```

- [ ] **Step 6: Create NotifierPort/EffectPort/SchedulerPort**

```typescript
// NotifierPort.ts
export interface NotifierPort {
  sendInfo(nearby: { displayName: string; dimensionId: string }, message: string): void;
  sendWarn(nearby: { displayName: string; dimensionId: string }, message: string): void;
  sendMessage(playerId: string, message: string): void;
}
```

```typescript
// EffectPort.ts
export interface EffectPort {
  playSortEffect(dimensionId: string, locations: unknown[], role: string): void;
  playOrganizeEffect(dimensionId: string, location: unknown): void;
}
```

```typescript
// SchedulerPort.ts
export interface SchedulerPort {
  start(warehouseId: string, tickInterval: number, callback: () => void): void;
  stop(warehouseId: string): void;
  stopAll(): void;
  refresh(warehouseId: string, tickInterval: number): void;
}
```

- [ ] **Step 7: Add port import test**

Create `tests/application/PortImports.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ContainerAccessPort } from "../../scripts/application/ports/ContainerAccessPort";
import type { WorldAccessPort } from "../../scripts/application/ports/WorldAccessPort";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("Port interfaces", () => {
  it("all port interfaces are importable without MC runtime", () => {
    // 只验证类型可编译，不创建实例
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 8: Run tests**

```bash
npm run test:domain
npm run test:application
npm run test:safety
```

Expected: all existing tests pass, plus new tests pass.

---

## Task 3: SortingPolicy Domain Service

**Files:**
- Create: `scripts/domain/sorting/types.ts`
- Create: `scripts/domain/sorting/SortingPolicy.ts`
- Modify: `tests/domain/SortingPolicyGolden.test.ts`

- [ ] **Step 1: Create domain sorting types**

```typescript
// scripts/domain/sorting/types.ts

export type RouteLevel = "bulk" | "normal" | "family" | "autocreate" | "misc";

/** 候选容器状态，决定路由决策 */
export interface CandidateState {
  bulkNonEmptyMatching: boolean;
  normalHasType: boolean;
  familyEnabledAndMatching: boolean;
  autoCreateEnabledAndEmptyNormal: boolean;
  miscAvailable: boolean;
}

/** 路由计划：按优先级排序的目标级别列表 */
export interface RoutePlan {
  levels: RouteLevel[];
}
```

- [ ] **Step 2: Create SortingPolicy**

```typescript
// scripts/domain/sorting/SortingPolicy.ts

import type { CandidateState, RouteLevel, RoutePlan } from "./types";

/**
 * 分拣路由优先级策略。
 *
 * 纯领域逻辑，不依赖 Minecraft 运行时。
 * 输入：候选容器状态；输出：按优先级排序的路由级别列表。
 * 当前源码真实优先级：大宗 -> 普通同类 -> 同族 -> 自动创建 -> 杂项。
 */
export function computeRouteOrder(state: CandidateState): RouteLevel[] {
  const order: RouteLevel[] = [];
  if (state.bulkNonEmptyMatching) order.push("bulk");
  if (state.normalHasType) order.push("normal");
  if (state.familyEnabledAndMatching) order.push("family");
  if (state.autoCreateEnabledAndEmptyNormal) order.push("autocreate");
  if (state.miscAvailable) order.push("misc");
  return order;
}

/**
 * 生成路由计划。
 */
export function planRoute(state: CandidateState): RoutePlan {
  return { levels: computeRouteOrder(state) };
}
```

- [ ] **Step 3: Update golden test to import from new domain**

Modify `tests/domain/SortingPolicyGolden.test.ts` to import `computeRouteOrder` from the new `scripts/domain/sorting/SortingPolicy.ts` instead of local definition. Keep the same test assertions to prove the extracted function matches the current code's behavior.

- [ ] **Step 4: Run test**

```bash
npm run test:domain
```

Expected: sorting golden tests still pass, now using the domain source.

---

## Task 4: Infrastructure SafeMinecraftAccess

**Files:**
- Create: `scripts/infrastructure/minecraft/SafeMinecraftAccess.ts`

- [ ] **Step 1: Create safe access helper**

```typescript
/**
 * Minecraft 运行时安全访问辅助函数。
 *
 * 所有 world/dimension/block/container 访问都必须通过此层，
 * 将运行时异常归一化为 undefined。
 */

import { world } from "@minecraft/server";
import type { Dimension, Block, Container } from "@minecraft/server";

/** 安全获取维度 */
export function safeGetDimension(dimensionId: string): Dimension | undefined {
  try {
    return world.getDimension(dimensionId);
  } catch {
    return undefined;
  }
}

/** 安全获取方块 */
export function safeGetBlock(dimension: Dimension, x: number, y: number, z: number): Block | undefined {
  try {
    return dimension.getBlock({ x, y, z });
  } catch {
    return undefined;
  }
}

/** 安全获取容器 inventory 组件 */
export function safeGetInventoryContainer(block: Block): Container | undefined {
  try {
    const inv = block.getComponent("inventory");
    return inv?.container;
  } catch {
    return undefined;
  }
}

/** 安全读取槽位物品 */
export function safeGetItem(container: Container, slot: number) {
  try {
    return container.getItem(slot);
  } catch {
    return undefined;
  }
}

/** 安全设置槽位物品 */
export function safeSetItem(container: Container, slot: number, stack?: import("@minecraft/server").ItemStack): boolean {
  try {
    container.setItem(slot, stack);
    return true;
  } catch {
    return false;
  }
}

/** 安全添加物品 */
export function safeAddItem(container: Container, stack: import("@minecraft/server").ItemStack) {
  try {
    return container.addItem(stack);
  } catch {
    return stack;
  }
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: TypeScript and bundle succeed.

---

## Task 5: UseCase Skeleton and Boundary Verification

**Files:**
- Create: `scripts/application/warehouse/CreateWarehouseUseCase.ts`
- Create: `scripts/application/sorting/MoveInputStackUseCase.ts`
- Create: `tests/application/BoundaryTest.test.ts`

- [ ] **Step 1: Create CreateWarehouseUseCase skeleton**

```typescript
/**
 * 创建仓库用例（骨架）。
 *
 * 暂时只有接口和空实现，不接入 main.ts。
 */

export class CreateWarehouseUseCase {
  execute(params: {
    name: string;
    dimensionId: string;
    pointA: { x: number; y: number; z: number };
    pointB: { x: number; y: number; z: number };
  }): string {
    // 骨架：仅验证参数存在
    if (!params.name?.trim()) return "仓库名称不能为空";
    if (!params.dimensionId) return "维度不能为空";
    return "ok";
  }
}
```

- [ ] **Step 2: Create MoveInputStackUseCase skeleton**

```typescript
/**
 * 输入槽分拣用例（骨架）。
 *
 * 后续将承接 SorterEngine.processInputContainer 的逻辑，
 * 当前仅定义接口占位。
 */

export class MoveInputStackUseCase {
  execute(params: { warehouseId: string }): { processed: boolean } {
    return { processed: false };
  }
}
```

- [ ] **Step 3: Add boundary verification test**

Create `tests/application/BoundaryTest.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CreateWarehouseUseCase } from "../../scripts/application/warehouse/CreateWarehouseUseCase";
import { MoveInputStackUseCase } from "../../scripts/application/sorting/MoveInputStackUseCase";

describe("Application boundary", () => {
  const create = new CreateWarehouseUseCase();
  const move = new MoveInputStackUseCase();

  it("CreateWarehouseUseCase validates empty name", () => {
    const result = create.execute({
      name: "",
      dimensionId: "minecraft:overworld",
      pointA: { x: 0, y: 60, z: 0 },
      pointB: { x: 10, y: 70, z: 10 },
    });
    expect(result).toBe("仓库名称不能为空");
  });

  it("MoveInputStackUseCase returns processed=false for skeleton", () => {
    const result = move.execute({ warehouseId: "nonexistent" });
    expect(result.processed).toBe(false);
  });
});
```

- [ ] **Step 4: Run full test suite**

```bash
npm run test:domain
npm run test:application
npm run test:safety
npm run test:integration
npm run build
```

Expected: all tests pass, build succeeds.

---

## 自检清单

- [ ] 没有修改 `scripts/main.ts` 或现有生产服务类。
- [ ] Domain 不导入 `@minecraft/server` 的 `Container/Block/Dimension/world/system` 类型。
- [ ] 端口接口在 `application/ports/`，不包含实现逻辑。
- [ ] 新代码中文注释（端口 JSDoc 可用中文）。
- [ ] 所有现有测试和构建仍然通过。
- [ ] 新增架构边界测试，验证 Domain 层不依赖 Minecraft 运行时。
