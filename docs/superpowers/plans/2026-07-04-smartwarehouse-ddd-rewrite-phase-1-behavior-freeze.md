# SmartWarehouse DDD Rewrite Phase 1 Behavior Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the current behavior of `/home/yinxin/project/mc/SmartWarehouse/scripts` with mocks, fixtures, and golden tests before any DDD rewrite code replaces the existing implementation.

**Architecture:** This phase adds a Node-runnable TypeScript test harness around the current code without changing production behavior. The tests model Minecraft API boundaries with explicit mocks and capture the latest `scripts/` behavior as the source of truth, including known bugs and high-risk constraints that the rewrite must preserve or intentionally fix.

**Tech Stack:** TypeScript strict mode, Vitest, mocked `@minecraft/server`, existing `npm run test:safety`, new `test:domain`, `test:application`, and `test:integration` npm scripts.

---

## File Structure

- Create: `tests/helpers/Assert.ts` — tiny assertion helpers shared by Node-run tests.
- Create: `tests/helpers/FakeDynamicPropertyStore.ts` — deterministic in-memory Dynamic Property adapter for repository compatibility tests.
- Create: `tests/helpers/MockMinecraft.ts` — reusable mock `ItemStack`, container, player, scheduler, and world helpers.
- Create: `tests/domain/SortingPolicyGolden.test.ts` — golden tests for the current route priority and documented constraints.
- Create: `tests/domain/WarehouseDomainGolden.test.ts` — golden tests for pure warehouse constraints that can be tested without Minecraft world IO.
- Create: `tests/application/MoveInputStackContract.test.ts` — transaction contract tests for target/input rollback expectations.
- Create: `tests/integration/WarehouseRepositoryCompat.test.ts` — old Dynamic Property version 1 fixture compatibility tests.
- Create: `tests/integration/PortContract.test.ts` — tests that adapter-facing operations normalize Minecraft API failures.
- Create: `vitest.config.ts` — shared Vitest config with `@minecraft/server` alias.
- Create: `tests/setup/MinecraftServerMock.ts` — Vitest-compatible mock module for Minecraft Script API.
- Modify: `package.json` — add Vitest dev dependency and `test:domain`, `test:application`, `test:integration` scripts.
- Modify: `docs/superpowers/specs/2026-07-04-smartwarehouse-ddd-rewrite-design.md` only if a test exposes a spec mismatch.

Do not modify production files in this phase except for the minimal exports needed to test current behavior. If a production export is required, add the smallest explicit export and run `npm run build` immediately after.

All newly added or modified code comments must be written in Chinese, including comments in test files.

## Task 1: Shared Test Helpers

**Files:**
- Create: `tests/helpers/Assert.ts`
- Create: `tests/helpers/MockMinecraft.ts`
- Create: `tests/helpers/FakeDynamicPropertyStore.ts`

- [ ] **Step 1: Create assertion helpers**

Create `tests/helpers/Assert.ts`:

```typescript
export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}
```

- [ ] **Step 2: Create Minecraft runtime mocks**

Create `tests/helpers/MockMinecraft.ts`:

```typescript
export class MockItemStack {
  readonly maxAmount = 64;
  nameTag?: string;

  constructor(
    readonly typeId: string,
    public amount: number
  ) {}

  clone(): MockItemStack {
    const cloned = new MockItemStack(this.typeId, this.amount);
    cloned.nameTag = this.nameTag;
    return cloned;
  }

  isStackableWith(other: MockItemStack): boolean {
    return this.typeId === other.typeId && this.nameTag === other.nameTag;
  }
}

export class MockContainer {
  failGetSlots = new Set<number>();
  failSetSlots = new Set<number>();
  failAddItem = false;

  constructor(
    readonly size: number,
    private readonly slots: (MockItemStack | undefined)[] = []
  ) {
    while (this.slots.length < size) this.slots.push(undefined);
  }

  get emptySlotsCount(): number {
    return this.slots.filter((slot) => !slot).length;
  }

  getItem(slot: number): MockItemStack | undefined {
    if (this.failGetSlots.has(slot)) throw new Error(`getItem failed at slot ${slot}`);
    return this.slots[slot]?.clone();
  }

  setItem(slot: number, item?: MockItemStack): void {
    if (this.failSetSlots.has(slot)) throw new Error(`setItem failed at slot ${slot}`);
    this.slots[slot] = item?.clone();
  }

  addItem(item: MockItemStack): MockItemStack | undefined {
    if (this.failAddItem) throw new Error("addItem failed");
    let remaining = item.amount;

    for (let slot = 0; slot < this.size; slot++) {
      const existing = this.slots[slot];
      if (!existing || !existing.isStackableWith(item) || existing.amount >= existing.maxAmount) continue;
      const moved = Math.min(remaining, existing.maxAmount - existing.amount);
      this.slots[slot] = new MockItemStack(existing.typeId, existing.amount + moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }

    for (let slot = 0; slot < this.size; slot++) {
      if (this.slots[slot]) continue;
      const moved = Math.min(remaining, item.maxAmount);
      this.slots[slot] = new MockItemStack(item.typeId, moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }

    return new MockItemStack(item.typeId, remaining);
  }

  dump(): Array<{ typeId: string; amount: number } | undefined> {
    return this.slots.map((slot) => (slot ? { typeId: slot.typeId, amount: slot.amount } : undefined));
  }
}
```

- [ ] **Step 3: Create fake Dynamic Property store**

Create `tests/helpers/FakeDynamicPropertyStore.ts`:

```typescript
export class FakeDynamicPropertyStore {
  readonly values = new Map<string, string | undefined>();

  getJson<T>(key: string, fallback: T): T {
    const raw = this.values.get(key);
    if (typeof raw !== "string") return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.values.set(key, undefined);
  }
}
```

- [ ] **Step 4: Run a focused TypeScript compile for helpers**

Run:

```bash
npx tsc --target ES2020 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir tmp/behavior-freeze-helpers tests/helpers/*.ts
```

Expected: command exits 0 and writes compiled helper files under `tmp/behavior-freeze-helpers`.

## Task 2: Vitest Configuration and Package Scripts

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup/MinecraftServerMock.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install Vitest**

Run:

```bash
npm install --save-dev vitest
```

Expected: `package.json` gains `vitest` under `devDependencies`, and `package-lock.json` updates.

- [ ] **Step 2: Create the Minecraft Script API mock**

Create `tests/setup/MinecraftServerMock.ts`:

```typescript
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
```

- [ ] **Step 3: Create shared Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/safety/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@minecraft/server": path.resolve(__dirname, "tests/setup/MinecraftServerMock.ts"),
    },
  },
});
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts to include:

```json
"test:domain": "vitest run tests/domain",
"test:application": "vitest run tests/application",
"test:integration": "vitest run tests/integration"
```

Keep the existing `test:safety` script unchanged.

- [ ] **Step 5: Run each new test script and verify it fails because tests do not exist yet**

Run:

```bash
npm run test:domain
npm run test:application
npm run test:integration
```

Expected: each script fails at TypeScript compile with missing `tests/domain/*.ts`, `tests/application/*.ts`, or `tests/integration/*.ts`. This confirms the runners are wired before adding tests.
Expected: each script exits non-zero with Vitest reporting that no test files were found for that directory. This confirms the scripts are wired before adding tests.

## Task 3: Domain Golden Tests

**Files:**
- Create: `tests/domain/SortingPolicyGolden.test.ts`
- Create: `tests/domain/WarehouseDomainGolden.test.ts`

- [ ] **Step 1: Add sorting priority golden tests**

Create `tests/domain/SortingPolicyGolden.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

type RouteLevel = "bulk" | "normal" | "family" | "autocreate" | "misc";

interface CandidateState {
  bulkNonEmptyMatching: boolean;
  normalHasType: boolean;
  familyEnabledAndMatching: boolean;
  autoCreateEnabledAndEmptyNormal: boolean;
  miscAvailable: boolean;
}

function currentRouteOrder(state: CandidateState): RouteLevel[] {
  const order: RouteLevel[] = [];
  if (state.bulkNonEmptyMatching) order.push("bulk");
  if (state.normalHasType) order.push("normal");
  if (state.familyEnabledAndMatching) order.push("family");
  if (state.autoCreateEnabledAndEmptyNormal) order.push("autocreate");
  if (state.miscAvailable) order.push("misc");
  return order;
}

describe("SortingPolicy golden behavior", () => {
  it("keeps the current route priority order", () => {
    expect(
      currentRouteOrder({
        bulkNonEmptyMatching: true,
        normalHasType: true,
        familyEnabledAndMatching: true,
        autoCreateEnabledAndEmptyNormal: true,
        miscAvailable: true,
      })
    ).toEqual(["bulk", "normal", "family", "autocreate", "misc"]);
  });

  it("routes auto-created categories before misc fallback", () => {
    expect(
      currentRouteOrder({
        bulkNonEmptyMatching: false,
        normalHasType: false,
        familyEnabledAndMatching: false,
        autoCreateEnabledAndEmptyNormal: true,
        miscAvailable: true,
      })
    ).toEqual(["autocreate", "misc"]);
  });

  it("does not let empty bulk containers claim new item types", () => {
    expect(
      currentRouteOrder({
        bulkNonEmptyMatching: false,
        normalHasType: true,
        familyEnabledAndMatching: false,
        autoCreateEnabledAndEmptyNormal: false,
        miscAvailable: true,
      })[0]
    ).toBe("normal");
  });
});
```

- [ ] **Step 2: Add warehouse/runtime model golden tests**

Create `tests/domain/WarehouseDomainGolden.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { WarehouseData } from "../../scripts/types";
import { buildWarehouseRuntimeModel } from "../../scripts/runtime/WarehouseRuntimeModel";

function baseWarehouse(): WarehouseData {
  return {
    version: 1,
    id: "main",
    displayName: "main",
    dimensionId: "minecraft:overworld",
    area: { min: { x: 0, y: 60, z: 0 }, max: { x: 10, y: 70, z: 10 } },
    ownerId: "",
    settings: {
      defaultNewContainerRole: "normal",
      defaultNewContainerEnabled: true,
      autoCreateCategories: true,
      enabled: true,
      processingSpeed: 8,
      debug: false,
      showBoundary: false,
      autoSortThreshold: 0,
      enabledFamilies: [],
      capacityWarning: true,
    },
    containerShardCount: 1,
    containerCount: 3,
    containerShardGeneration: 1,
    containers: {
      input1: {
        id: "input1",
        dimensionId: "minecraft:overworld",
        primaryLocation: { x: 1, y: 64, z: 1 },
        occupiedLocations: [{ x: 1, y: 64, z: 1 }],
        role: "input",
        enabled: true,
        discoveredAt: 1,
        updatedAt: 1,
      },
      disabled1: {
        id: "disabled1",
        dimensionId: "minecraft:overworld",
        primaryLocation: { x: 2, y: 64, z: 1 },
        occupiedLocations: [{ x: 2, y: 64, z: 1 }],
        role: "normal",
        enabled: false,
        discoveredAt: 1,
        updatedAt: 1,
      },
      normalDouble: {
        id: "normalDouble",
        dimensionId: "minecraft:overworld",
        primaryLocation: { x: 3, y: 64, z: 1 },
        occupiedLocations: [{ x: 3, y: 64, z: 1 }, { x: 4, y: 64, z: 1 }],
        role: "normal",
        enabled: true,
        discoveredAt: 1,
        updatedAt: 1,
      },
    },
  };
}

describe("Warehouse runtime model golden behavior", () => {
  it("indexes enabled, disabled, and double chest occupied locations like the current code", () => {
    const warehouse = baseWarehouse();
    const model = buildWarehouseRuntimeModel(warehouse);

    expect(model.inputContainerIds.length).toBe(1);
    expect(model.normalContainerIds.length).toBe(1);
    expect(model.disabledContainerIds.length).toBe(1);
    expect(model.occupiedLocationIndex.size).toBe(4);
  });

  it("copies occupiedLocations instead of sharing persistent arrays", () => {
    const warehouse = baseWarehouse();
    const model = buildWarehouseRuntimeModel(warehouse);
    const storedBefore = warehouse.containers.normalDouble.occupiedLocations.length;
    const runtimeContainer = model.containersById.get("normalDouble");

    expect(runtimeContainer).toBeDefined();
    runtimeContainer?.occupiedLocations.pop();
    expect(warehouse.containers.normalDouble.occupiedLocations.length).toBe(storedBefore);
  });
});
```

- [ ] **Step 3: Run domain tests**

Run:

```bash
npm run test:domain
```

Expected: `domain tests: PASSED`.

## Task 4: Application Transaction Contract Tests

**Files:**
- Create: `tests/application/MoveInputStackContract.test.ts`
- Modify: `docs/superpowers/specs/2026-07-04-smartwarehouse-ddd-rewrite-design.md` if the current implementation cannot satisfy the stronger input-slot rollback contract.

- [ ] **Step 1: Add transaction contract tests**

Create `tests/application/MoveInputStackContract.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { MockContainer, MockItemStack } from "../helpers/MockMinecraft";
import { MoveJournal } from "../../scripts/sorting/MoveJournal";
import { tryMoveStackIntoContainerWithJournal } from "../../scripts/sorting/ContainerInventory";

describe("Move input stack transaction contract", () => {
  it("can roll back target container writes recorded by MoveJournal", () => {
    const target = new MockContainer(2, [new MockItemStack("minecraft:stone", 60), undefined]);
    const journal = new MoveJournal();

    const remaining = tryMoveStackIntoContainerWithJournal(
      new MockItemStack("minecraft:stone", 8) as any,
      target as any,
      journal,
      "target-1"
    );

    expect(remaining).toBeUndefined();
    expect(target.dump()).toEqual([{ typeId: "minecraft:stone", amount: 64 }, { typeId: "minecraft:stone", amount: 4 }]);

    const rollback = journal.rollback();
    expect(rollback.ok).toBe(true);
    expect(target.dump()).toEqual([{ typeId: "minecraft:stone", amount: 60 }, undefined]);
  });

  it("models input slot commit failure for the rewrite contract", () => {
    const input = new MockContainer(1, [new MockItemStack("minecraft:diamond", 3)]);
    input.failSetSlots.add(0);

    expect(() => input.setItem(0, undefined)).toThrow("setItem failed at slot 0");
    expect(input.dump()).toEqual([{ typeId: "minecraft:diamond", amount: 3 }]);
  });
});
```

- [ ] **Step 2: Run application tests**

Run:

```bash
npm run test:application
```

Expected: `application tests: PASSED` if the existing helper compiles cleanly. If it fails because production imports pull too much Minecraft runtime, add the missing mock exports to `tests/run-application-tests.mjs` and rerun.

- [ ] **Step 3: Record the known gap**

If the tests only prove target rollback and not full input-slot snapshot behavior, keep the stronger requirement in the spec and add a short note to the test file header:

```typescript
// 这里冻结当前目标容器回滚 helper；DDD 重写必须按设计规格补上输入槽快照覆盖。
```

Run `npm run test:application` again after adding the note.

## Task 5: Integration Compatibility Tests

**Files:**
- Create: `tests/integration/WarehouseRepositoryCompat.test.ts`
- Create: `tests/integration/PortContract.test.ts`

- [ ] **Step 1: Add repository compatibility tests**

Create `tests/integration/WarehouseRepositoryCompat.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { FakeDynamicPropertyStore } from "../helpers/FakeDynamicPropertyStore";
import { WarehouseRepository } from "../../scripts/storage/WarehouseRepository";

function key(id: string, generation: number, shard: number): string {
  return `sw:warehouse:${id}:${generation}:containers:${shard}`;
}

describe("WarehouseRepository legacy compatibility", () => {
  it("loads version 1 shards and defaults missing settings", () => {
    const store = new FakeDynamicPropertyStore();
    store.setJson("sw:index", { version: 1, warehouses: ["legacy"] });
    store.setJson("sw:warehouse:legacy:meta", {
      version: 1,
      id: "legacy",
      displayName: "Legacy",
      dimensionId: "minecraft:overworld",
      area: { min: { x: 0, y: 60, z: 0 }, max: { x: 3, y: 70, z: 3 } },
      ownerId: "",
      settings: { enabled: true, defaultNewContainerRole: "normal", defaultNewContainerEnabled: true },
      containerShardCount: 1,
      containerCount: 1,
      containerShardGeneration: 7,
    });
    store.setJson(key("legacy", 7, 0), {
      version: 1,
      warehouseId: "legacy",
      shardIndex: 0,
      containers: {
        c1: {
          id: "c1",
          dimensionId: "minecraft:overworld",
          primaryLocation: { x: 1, y: 64, z: 1 },
          occupiedLocations: [{ x: 1, y: 64, z: 1 }],
          role: "normal",
          enabled: true,
          discoveredAt: 1,
          updatedAt: 1,
        },
      },
    });
    store.setJson(key("legacy", 6, 0), { version: 1, warehouseId: "legacy", shardIndex: 0, containers: {} });

    const repo = new WarehouseRepository(store as any);
    const loaded = repo.load("legacy");

    expect(loaded).toBeDefined();
    expect(loaded?.settings.capacityWarning).toBe(true);
    expect(Array.isArray(loaded?.settings.enabledFamilies)).toBe(true);
    expect(loaded?.containerShardGeneration).toBe(7);
    expect(Object.keys(loaded?.containers ?? {}).length).toBe(1);
  });
});
```

- [ ] **Step 2: Add port contract tests**

Create `tests/integration/PortContract.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

describe("Port contract helpers", () => {
  it("normalizes thrown Minecraft API failures", () => {
    const result = safe(() => {
      throw new Error("unloaded chunk");
    });

    expect(result).toBeUndefined();
  });

  it("normalizes disconnected-player notification failures", () => {
    const messageResult = safe(() => {
      throw new Error("player disconnected");
    });

    expect(messageResult).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run integration tests**

Run:

```bash
npm run test:integration
```

Expected: `integration tests: PASSED`.

If `WarehouseRepository` cannot be constructed with `FakeDynamicPropertyStore` because the constructor type is too concrete, make the smallest production change: introduce an interface-compatible constructor type in `scripts/storage/WarehouseRepository.ts`:

```typescript
interface JsonStore {
  getJson<T>(key: string, fallback: T): T;
  setJson(key: string, value: unknown): void;
  delete(key: string): void;
}
```

Then change the constructor parameter to:

```typescript
constructor(private readonly store: JsonStore = new DynamicPropertyStore()) {}
```

Run `npm run build` immediately after this production change.

## Task 6: Verification and Documentation Checkpoint

**Files:**
- Modify: `docs/superpowers/specs/2026-07-04-smartwarehouse-ddd-rewrite-design.md` only if tests reveal a spec mismatch.

- [ ] **Step 1: Run the full behavior-freeze suite**

Run:

```bash
npm run test:safety
npm run test:domain
npm run test:application
npm run test:integration
npm run build
```

Expected: all commands exit 0. If any command fails, fix the test harness or update the spec only when the current `/scripts` behavior proves the spec is wrong.

- [ ] **Step 2: Check for accidental production behavior changes**

Run:

```bash
git diff -- scripts tests package.json docs/superpowers/specs/2026-07-04-smartwarehouse-ddd-rewrite-design.md
```

Expected: production changes are limited to explicit testability exports or the `WarehouseRepository` store interface if Task 5 required it. No sorting or warehouse business behavior should change in Phase 1.

- [ ] **Step 3: Stop before Phase 2**

Do not start Domain/Application rewrite until Phase 1 tests pass and the user approves continuing. This checkpoint is mandatory because Phase 2 will begin moving production behavior.
