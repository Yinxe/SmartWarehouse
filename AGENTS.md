# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 常用命令

```bash
# 安装依赖
npm install

# 构建（TypeScript 编译 + esbuild 打包）
npm run build

# 仅 TypeScript 编译（检查类型错误，不输出产物）
npx tsc --noEmit

# 仅编译（无打包）
npx tsc

# Lint
npm run lint

# 运行所有单元测试（vitest，排除 tests/safety/）
npx vitest run

# 运行特定模块的测试
npx vitest run tests/sorting                # 分拣算法测试
npx vitest run tests/application            # 应用层测试
npx vitest run tests/integration            # 集成测试

# 运行安全测试（模拟 Minecraft 容器 IO，需要 node 环境）
node tests/run-safety-tests.mjs

# 一键打包 .mcaddon
npm run mcaddon               # 产物在 dist/packages/

# 本地热部署（监听文件变化，自动编译+复制到行为包）
npm run local-deploy          # 需要 .env 中配置的行为包路径
```

**注意**：该项目的 Minecraft 模组构建使用 `just-scripts` + `@minecraft/core-build-tasks`（见 `just.config.ts`），而非纯 tsc。

---

## 参考文档

- **官方 API**: https://learn.microsoft.com/zh-cn/minecraft/creator/?view=minecraft-bedrock-stable
- **Script API (@minecraft/server)**: 上述链接重点章节
- **社区 Wiki**: https://wiki.bedrock.dev/（自定义物品/方块/Molang/动画…）
- **翻译表**: https://raw.githubusercontent.com/SkyEye-FAST/mcbe-chinese-patch/main/extracted/release/vanilla/zh_CN.json

---

## 项目架构（扁平多模块）

```
scripts/
├── main.ts              入口：依赖注入、注册事件和命令
├── types.ts             集中式类型定义（re-export 汇集点）
├── commands/            命令路由 + 参数解析 + 权限校验
│   ├── CommandRouter.ts
│   ├── handlers/        create/resize/delete/organize/menu/search
│   └── validators/      ParameterParser.ts + PermissionValidator.ts
├── data/                静态数据文件
│   ├── ItemFamilies.ts  51 家族 / 1431 物品分类
│   └── name-maps/       中文译名映射（按物品类型分文件）
├── persistence/         持久化层（Minecraft Dynamic Property）
│   ├── WarehouseRepository.ts    仓库数据读写
│   ├── DynamicPropertyStore.ts   底层 DP 序列化
│   ├── ModConfigStore.ts         模组配置
│   ├── WarehouseRuntimeRegistry.ts  运行时缓存索引
│   └── WarehouseStatsStore.ts    统计缓存
├── player/              玩家交互事件层
│   ├── ToolInteractionController.ts  木锄右键事件
│   ├── containerClickHandler.ts      容器点击
│   ├── nonContainerClickHandler.ts   非容器方块点击
│   ├── quickOrganizeHandler.ts      一键整理
│   └── SelectionSessionStore.ts     选区状态管理
├── sorting/             分拣引擎与调度
│   ├── SorterEngine.ts       核心分拣引擎
│   ├── SortingScheduler.ts   轮询调度器
│   ├── ContainerSelector.ts  容器选择策略
│   ├── ContainerTypes.ts     容器类型判断
│   ├── algorithm/       分拣算法（领域层，纯逻辑可单元测试）
│   │   ├── SortingPolicy.ts       分拣策略编排
│   │   ├── FamilyPurity.ts        同类物品纯度计算
│   │   ├── CapacityCheck.ts       剩余容量检测
│   │   ├── IndexSelfHealing.ts    索引自愈
│   │   ├── MessinessScore.ts      混乱度评分
│   │   ├── PurityRanking.ts       纯度排序
│   │   ├── ContainerView.ts       容器视图接口
│   │   └── ContainerInventory.ts  物品清单值对象
│   ├── io/              Minecraft 容器 IO 适配器
│   │   ├── ContainerAccess.ts     容器访问接口
│   │   ├── ContainerSnapshot.ts   快照与回滚
│   │   ├── MoveJournal.ts         物品移动日志
│   │   └── SlotOrganizer.ts       槽位整理器
│   └── effect/          分拣效果（粒子、声音、通知）
│       ├── SortEffects.ts
│       └── WarehouseNotifier.ts
├── ui/                  玩家交互界面（ActionForm / ModalForm）
│   ├── MainMenu.ts, WarehouseCreateFlow.ts, WarehouseManageMenu.ts
│   ├── WarehouseSettingsMenu.ts, ContainerRoleMenu.ts, FamilyConfigMenu.ts
│   ├── WarehouseStats.ts, SearchUI.ts, ConfigUI.ts
│   ├── FormHelper.ts, Table.ts, OrganizeFormatter.ts
│   └── OrganizeTypes.ts
├── util/                工具函数
│   ├── Logger.ts, Vector.ts, Json.ts, errors.ts
├── warehouse/           核心业务逻辑
│   ├── WarehouseService.ts      仓库 CRUD + 方块事件维护
│   ├── WarehouseStatsService.ts 统计计算
│   ├── WarehouseRescanDiff.ts   重扫差异比较
│   ├── ContainerId.ts           ID 生成
│   ├── ContainerTypes.ts        容器类型检查
│   └── WarehouseTypes.ts, WarehouseRuntimeModel.ts, ContainerTypes.ts
│   ├── render/          BoundaryDisplay.ts 粒子光幕渲染
│   ├── scanner/         ContainerScanner.ts + SafeProbe.ts
│   └── search/          SearchService.ts
tests/
├── sorting/             分拣算法单元测试（vitest）
├── application/         应用层测试（权限校验等）
├── integration/         集成测试（仓库持久化兼容、端口契约）
├── safety/              安全测试（模拟容器 IO，mock 模式）
├── helpers/             测试工具（MockMinecraft, FakeDynamicPropertyStore, Assert）
└── setup/               MinecraftServerMock.ts（@minecraft/server mock for vitest）
```

**构建流程**：`scripts/` → tsc 类型检查 → esbuild 打包 → `dist/scripts/main.js` → 复制到行为包目录

### 分层逻辑（非 DDD，按职责分模块）

| 层 | 目录 | 说明 |
|---|---|---|
| 输入层 | `commands/` `player/` `ui/` | 命令/交互/UI → 调用 warehouse 或 sorting |
| 业务逻辑 | `warehouse/` `sorting/` | 仓库管理、分拣引擎、容器扫描 |
| 算法（纯逻辑） | `sorting/algorithm/` | 零 Minecraft 依赖，可纯单元测试 |
| 基础设施 | `persistence/` `sorting/io/` `sorting/effect/` | Minecraft 运行时适配器 |
| 工具 | `util/` | 与业务无关的通用工具 |
| 数据 | `data/` | 静态物品分类、译名映射 |

### 初始化流程（main.ts）

```
ModConfigStore → WarehouseRepository → WarehouseRuntimeRegistry
                → SlotOrganizer → SorterEngine → SortingScheduler
                → WarehouseService → BoundaryDisplay
                → registerToolInteraction → CommandRouter
                → system.run(scheduler.start + boundaryDisplay.start)
```

### 分拣流程

```
player 放入 input 容器
  → SortingScheduler 轮询触发
  → SorterEngine.processWarehouse(warehouseId)
  → ContainerSelector 选择最佳目标容器（按角色/纯度/容量）
  → MoveJournal 记录移动，SlotOrganizer 整理
  → SortEffects 播放粒子/声音
```

---

## 测试架构

项目使用 **vitest** 运行测试（配置见 `vitest.config.ts`），`@minecraft/server` 在测试环境中被 mock 替换：

```typescript
// vitest.config.ts resolve.alias
"@minecraft/server": path.resolve(__dirname, "tests/setup/MinecraftServerMock.ts")
```

**测试分组：**

| 组 | 命令 | 内容 |
|---|---|---|
| sorting | `vitest run tests/sorting` | 分拣算法单元测试（纯逻辑，最快） |
| application | `vitest run tests/application` | 权限校验等应用层 |
| integration | `vitest run tests/integration` | 持久化兼容、端口契约 |
| safety | `node tests/run-safety-tests.mjs` | 容器 IO 安全测试（需要 node） |

**测试 helper：**
- `MockMinecraft.ts` — 工厂函数创建 mock 容器/方块/世界
- `FakeDynamicPropertyStore.ts` — 使用 `Map` 模拟 DynamicProperty 存储
- `Assert.ts` — 自定义断言工具（近似值比较、集合比较等）
- `MinecraftServerMock.ts` — 全局 mock（vitest alias 注入）

**注意**：safety 测试由于需要模拟 Minecraft 容器 IO 的复杂行为，不在 vitest 中运行（通过 `exclude` 排除），需要使用 `node tests/run-safety-tests.mjs` 独立执行。

---

## 代码风格与约定

### 命名规范

| 类别 | 风格 | 示例 |
|------|------|------|
| 类 | PascalCase | `WarehouseService`, `CommandRouter`, `SorterEngine` |
| 接口 | PascalCase | `WarehouseData`, `StoredContainer`, `WarehouseMeta` |
| 类型别名 | PascalCase | `WarehouseId`, `ContainerRole`, `BlockLocation` |
| 文件 | PascalCase | `WarehouseService.ts`, `ContainerScanner.ts`, `Logger.ts` |
| 导出函数 | camelCase | `createWarehouse()`, `isInsideArea()`, `locationKey()` |
| 私有方法 | camelCase | `handleCreate()`, `assertScanVolume()`, `checkAreaLoaded()` |
| 常量（模块级） | UPPER_SNAKE_CASE | `MAX_SCAN_VOLUME`, `CONTAINERS_PER_SHARD`, `DEBOUNCE_MS` |
| 固定值常量 | PascalCase | `ROLE_LABELS`, `ROLE_ORDER`, `SPEED_LABELS` |
| 类型化 ID | `XxxId` 后缀 | `WarehouseId`, `ContainerId`, `DimensionId` |
| 坐标键 | `locationKey()` 工厂 | `"dimensionId\|x\|y\|z"` 格式 |

**特例：** `main.ts`（入口）、`types.ts`（集中类型定义）保持小写。

### 导入规范

```typescript
// 1. 外部依赖
import { world, system } from "@minecraft/server";
// 2. 仅类型导入时使用 type 关键字
import type { Vector3 } from "@minecraft/server";
// 3. 内部模块（相对路径）
import { normalizeWarehouseId } from "../persistence/WarehouseRepository";
import { Logger } from "../util/Logger";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { computeRouteOrder } from "../sorting/algorithm/SortingPolicy";
// 4. 同类导入可混合
import { system, type Dimension } from "@minecraft/server";
import { world, type Player, type CustomCommand } from "@minecraft/server";
```

### 文档注释

- **JSDoc 使用中文**，遵循 `/** */` 格式
- **每个导出函数/类**必须有 JSDoc
- 结构：`@param name - 描述`（- 分隔）、`@returns`、`@throws`
- **复杂算法**：多段落 + 列表/表格
- **模块头注释**：可选的大文件总结

### 错误处理模式

```typescript
// 模式 1: 返回错误消息（轻量校验，如命令解析）
function parseCommandPlayer(origin): Player | string {
  if (!(entity instanceof Player)) return "该命令只能由玩家执行";
  return entity;
}

// 模式 2: 抛出异常（业务逻辑层）
function createWarehouse(...): WarehouseData {
  if (this.repository.exists(id)) throw new Error(`仓库 ${id} 已存在`);
}

// 模式 3: 安全执行 + 返回 undefined（可能失败的 IO 操作）
function getDimensionSafe(dimensionId): Dimension | undefined {
  try { return world.getDimension(dimensionId); } catch { return undefined; }
}

// 模式 4: 事件处理器内的 try-catch（防止单个事件崩溃影响全局）
world.afterEvents.playerPlaceBlock.subscribe((event) => {
  try { /* ... */ } catch (e) {
    console.warn("[SmartWarehouse] playerPlaceBlock 事件处理器错误:", e);
  }
});
```

### 依赖注入

```typescript
// 构造函数注入，可选依赖用默认参数（方便测试时注入 mock）
export class WarehouseService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly scanner = new ContainerScanner(),  // 可注入
    private readonly markRuntimeDirty: (id: WarehouseId) => void = () => undefined
  ) {}
}
```

### 类型定义模式

```typescript
// Union type + 中文 JSDoc
export type ContainerRole = "normal" | "misc" | "bulk" | "input";
// Record 常量为 UI 展示
export const ROLE_LABELS: Record<ContainerRole, string> = {
  normal: "普通", misc: "杂项", bulk: "批量", input: "输入",
};
// 受歧视联合用于状态机
export type SelectionSession =
  | { type: "createWarehouse"; warehouseName: string; pointA?: BlockLocation }
  | { type: "resizeWarehouse"; warehouseId: WarehouseId; pointA?: BlockLocation };
```

### Minecraft 特有模式

- **事件驱动初始化**（main.ts）：脚本启动时一次性初始化所有子系统，延迟到下一 tick 启动调度（dynamicProperty 需世界完全加载后才可用）
- **命令注册**：在 `system.beforeEvents.startup` 中通过 `event.customCommandRegistry.registerCommand` 注册
- **区块安全访问**：`dimension.getBlock()` 用 try-catch 保护
- **容器角色**：`input`（输入，漏斗默认）、`normal`（主存储）、`misc`（杂项）、`bulk`（大宗含潜影盒拆填）
- **增量维护**：方块放置/破坏事件处理器增量添加/移除容器记录，不做全量扫描

### 通用编码习惯

- `private readonly` 构造参数简写
- `Map<K, V>` 显式声明泛型
- `Record<K, V>` 用于对象字典
- UI 相关方法用 `async/await`；业务逻辑同步执行
- 分拣相关方法必须是**幂等**的（`start()` / `stop()`）
- 面向玩家的错误消息使用中文；调试日志使用英文
- 日志通过 `Logger` 类统一输出，底层使用 `console.warn`，格式 `[SmartWarehouse] 消息`
- 模块级常量就近定义（不集中放 constants 文件）
