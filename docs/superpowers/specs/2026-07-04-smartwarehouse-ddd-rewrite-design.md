# SmartWarehouse DDD 一次性重写设计规格

日期：2026-07-04

## 1. 目标与原则

SmartWarehouse 当前已经具备仓库管理、自动分拣、运行时索引、容量统计、安全回滚等能力，但核心行为集中在少数大文件中，后续改 bug 容易牵连旧逻辑。此次重写目标是把复杂分拣领域建模清楚，用 DDD + Hexagonal 的边界降低维护成本，同时完整保留历史注释中积累的 Minecraft API 经验。

这次采用一次性重写作为设计基线，但不是无保护重写。必须先冻结关键行为、兼容旧 Dynamic Property 数据、保留物品安全策略，再替换实现。

重构行为基线只以最新源码目录为准：`/home/yinxin/project/mc/SmartWarehouse/scripts`。旧设计文档、README 和历史计划只能作为背景材料；当文档与最新源码不一致时，必须以 `scripts/` 中的当前实现和注释为准，并在重构过程中修正文档。

硬性原则：

- 宁可停用仓库，也不能吞物品、复制物品、误动玩家已有箱子。
- 旧世界数据必须可读；旧仓库不能因为重写而丢失管理关系。
- 当前代码注释中的经验必须迁移到新模块 JSDoc、端口契约或迁移说明中。
- 后续所有新增或修改的代码注释必须使用中文，包括测试代码注释。
- `ItemFamilies.ts` 是生成文件，不作为人工重构对象；修改分类时仍通过生成器和注释工具。
- 面向玩家的消息继续使用中文。

## 2. Domain 边界

Domain 只允许进入稳定的值语义对象：

- 允许：`ItemStack`，以及项目自定义值对象 `WarehouseId`、`ContainerId`、`DimensionId`、`BlockLocation`、`WarehouseArea`。
- 禁止：`Container`、`Block`、`Dimension`、`Player`、`world`、`system`、Dynamic Property、UI Form。

理由：`ItemStack` 承载物品类型、数量和堆叠语义，是分拣领域的一部分；`Container` 是运行时 IO 对象，难以 mock、外部可变、可能因区块/坐标/API 限制抛错，必须放在端口之后。

## 3. 目标目录

```text
scripts/
  domain/
    warehouse/
    sorting/
    inventory/
    families/
    shared/
  application/
    warehouse/
    sorting/
    stats/
    search/
    ports/
  infrastructure/
    minecraft/
    persistence/
    generated/
    effects/
    config/
  interfaces/
    commands/
    interaction/
    ui/
    bootstrap/
```

边界规则：Domain 表达业务规则；Application 编排用例和事务；Infrastructure 适配 Minecraft API、Dynamic Property、粒子音效、配置；Interfaces 处理命令、木锄交互、UI 表单和入口组合。

## 4. 领域模型

### WarehouseAggregate

负责仓库自身不变式：名称、区域、设置、容器集合、容器归属、合箱/拆箱语义。

必须保留规则：

- 区域由两个角点归一化。
- 创建/调整区域前检查体积、边长、仓库间距。
- 容器数量受全局上限保护。
- 漏斗强制 `input`，不可作为普通存储角色。
- `enabled` 独立于 `role`，禁用容器不参与任何分拣。
- 双箱只登记一个逻辑容器，`occupiedLocations` 保存所有占用坐标。

### SortingPolicy

负责路由决策，不执行容器写入。当前真实优先级必须保持：

1. 大宗容器：非空且第一种物品匹配，空大宗箱不自动接收新类型；当前源码没有 `bulkTypeId` 配置，重写不得凭旧文档新增该字段。
2. 普通同类容器：通过运行时索引快速定位，并校验真实容器内容。
3. 同族容器：仅对启用家族生效，按家族纯度降序。
4. 自动创建分类：开启后选择第一个空 normal 容器。
5. 杂项容器：兜底。

降级与容量预警规则必须保留：同级溢出不告警，跨级降级/全满才告警；组容量冷却只限制消息频率，不阻止统计刷新。

### RuntimeIndexPolicy

负责运行时索引自愈规则。`itemTypeIndex` 和 `familyTypeIndex` 不能持久化；过期索引不能导致数据丢失，只能触发校验、清理或全量回退扫描。

### Inventory Domain

保留 `ItemStack.clone()` 快照思想，但不让 `Container` 进入 Domain。Domain 接收 `ContainerView`、`SlotView` 或快照数据，产出排序计划、路由计划、回滚需求。

`MoveJournal` 和写入回滚属于 Application 事务边界，不属于 Domain。Domain 层只能描述需要快照/回滚的计划；真正持有运行时容器引用、调用 `setItem()`/`addItem()`/`restore()` 的代码必须位于 Application use case 或 Infrastructure adapter。

`SlotOrganizer` 需要拆分为两部分：排序和混乱度规则进入 Domain；读取/写入 `Container`、锁控制、失败回滚留在 Application/Infrastructure。现有容器级锁语义必须保留，防止整理与分拣同时写同一容器。

## 5. Application 用例与端口

核心端口：

- `WarehouseRepositoryPort`：仓库读写、旧数据兼容、分片写入。
- `ContainerAccessPort`：容器视图读取、目标写入、输入槽提交、快照与恢复。
- `WorldAccessPort`：维度、方块、区域扫描、双箱占用坐标、区块加载检查。
- `RuntimeRegistryPort`：运行时模型、dirty 标记、游标、释放。
- `StatsPort`：统计读取、刷新、失效。
- `NotifierPort`：玩家和附近玩家消息。
- `SchedulerPort`：interval 生命周期。
- `EffectPort`：分拣粒子、音效、边界显示等视觉反馈。

主要用例：

- 仓库：Create、Resize、Rescan、PreviewRescan、Delete、Rename、UpdateSettings、UpdateContainerRole、HandleContainerPlaced、HandleContainerBroken。
- 分拣：ProcessWarehouse、ProcessInputContainer、MoveInputStack、BuildRouteCandidates、ApplyRoutePlan。
- 统计：ComputeWarehouseStats、RefreshContainerStats、CheckCapacityWarning。
- 搜索：SearchWarehouse。

`MoveInputStackUseCase` 是物品安全核心：每次只处理一个 input slot；写目标容器前建立短生命周期 journal；目标写入成功后才提交输入槽清空或余量回写；输入槽提交失败则回滚目标容器；回滚失败则停用仓库。

journal 必须同时覆盖目标容器和输入槽：目标容器写入前记录目标快照，输入槽提交前记录输入槽快照。目标写入、输入槽清空/回写、回滚中任一步失败，都必须返回明确结果并阻止系统继续假定本 tick 已成功完成。

`RescanWarehouseUseCase` 完成后必须触发 runtime dirty、统计失效和调度刷新。当前源码的 `rescanWarehouse()` 已标记 dirty 和清统计，但没有通知调度器；重写时必须修复该行为。

## 6. Infrastructure 与 Interfaces

`registerBlockMaintenance()` 不再属于业务服务，移动到 `interfaces/interaction` 的事件适配器。命令和 UI 也只调用 Application 用例，不直接操作 repository/runtime。

`ui/WarehouseStats.ts` 中非展示逻辑必须移到 `application/stats` 或 `infrastructure/persistence`，UI 只负责格式化表单和文本。

Minecraft 访问适配器必须吞掉并归一化运行时异常：未加载区块、越界坐标、无效维度、inventory 不可用、玩家断线，都不能穿透到 Domain。

配置读写需要统一策略。`ModConfigStore` 可以继续保持小型配置的独立存储，但必须使用与 `DynamicPropertyStore` 等价的 JSON 解析、安全 fallback 和写入错误处理；不能让配置存储绕过项目统一的 DP 安全习惯。

脚本启动时继续保留延迟访问 Dynamic Property 的经验：组合根可以注册命令/事件，但读取仓库 DP、启动调度器、启动边界显示必须在 `system.run()` 或等价的世界加载后阶段执行。

## 7. 持久化兼容

第一阶段不更改现有 Dynamic Property key：

```text
sw:index
sw:warehouse:<id>:meta
sw:warehouse:<id>:<generation>:containers:<shardIndex>
sw:warehouse:<id>:cstats:<containerId>
```

Repository 继续支持 version 1：读取 meta/shard，补齐旧 settings 缺失字段，合并分片，执行 `containerCount` 完整性校验。完整性失败时记录错误，不自动删除数据。

写入仍保留崩溃安全顺序：先写新世代分片，再写 meta 指向新世代，最后清理旧世代。高频容器变更可继续覆写当前世代分片，但方法名要表达风险和语义。

当前 `patchContainers()` 风格的“覆写当前世代分片”不是崩溃安全写入：多分片写到一半时可能出现 meta 仍指向同一世代但分片内容不一致。重写时必须二选一：保留该优化但在方法名/JSDoc/调用点标注风险，或改为 generation bump + debounce 的安全写入策略。默认选择安全优先，除非性能测试证明必须保留当前世代覆写。

序列化红线：禁止持久化 `ItemStack`、`Container`、`Block`、`Dimension`、`Player`；只持久化 JSON-safe DTO。

`ContainerStats` 当前无版本字段。由于统计是派生缓存，默认策略是允许清空重建，不做复杂迁移；Repository/StatsStore 必须能在读取异常或字段缺失时删除该条统计并现场重算。

## 8. 加强测试策略

重写第一阶段是测试和 fixture，不是改目录。

新增 mock/fixture：

- `MockWorldAccess`
- `MockContainerAccess`
- `MockScheduler`
- `MockNotifier`
- `FakeDynamicPropertyStore`
- 旧 version 1 DP fixture：settings 缺字段、分片缺失、旧世代残留、containerCount 不一致。

测试分层：

```text
tests/domain/
tests/application/
tests/integration/
tests/safety/
```

必须覆盖：仓库创建约束、扫描和双箱、漏斗强制 input、合箱/拆箱继承、真实路由优先级、同族纯度排序、运行时索引自愈、输入槽事务回滚、回滚失败停用、容量预警互斥、旧 DP 兼容、端口异常归一化。

旧 DP fixture 至少覆盖：`settings` 缺 `enabledFamilies`/`capacityWarning`/`autoSortThreshold`，`containerCount` 与实际分片不一致，旧世代分片残留，空分片，统计缓存字段缺失或格式错误。

故障注入至少覆盖：目标容器不可达，目标写入失败，输入槽清空失败，输入槽余量回写失败，回滚中某槽恢复失败，玩家消息发送失败，区块加载检查失败。

并发/交互测试至少覆盖：同一容器整理和分拣竞争，同一仓库被 UI 改角色时分拣 tick 正在运行，玩家选区会话长时间不完成后的超时清理。

Golden tests 必须固化当前真实路由行为，避免按旧文档误改。文档一致性也纳入验收：`README.md`、`docs/routing-flow.md` 和代码实现的路由顺序必须一致。

验收命令：

```bash
npm run test:safety
npm run test:domain
npm run test:application
npm run build
```

## 9. 文档迁移

重写过程中需要更新：

- `README.md`：修正分拣优先级描述。
- `docs/routing-flow.md`：移除或标记当前不可用的 `bulkTypeId`、潜影盒自动填充说明，改成当前真实行为。
- 新模块 JSDoc：保留 Dynamic Property 大小限制、早期 world DP 不可用、区块未加载、双箱探针、ItemStack clone、rollback、回滚失败停用仓库等历史经验。
- `docs/item-family-guide.md` 与生成工具路径：如果 `ItemFamilies.ts` 迁移到新目录，必须同步更新 `tools/generateItemFamilies.mjs` 和 `tools/annotateFamilies.mjs` 的输出/注释路径。

## 10. 实施阶段建议

1. 建立测试夹具和 golden tests，冻结当前行为。
2. 建立新目录和端口接口，不接入旧入口。
3. 搬迁 Domain 规则，保持旧实现并行可对照。
4. 搬迁 Application 用例，接入 mock 测试。
5. 实现 Infrastructure 适配器，兼容旧 Dynamic Property。
6. 切换 commands/UI/interaction/bootstrap 到新用例。
7. 修正文档并运行完整构建与测试。

## 11. 默认决策

- 旧实现保留到新实现通过 golden tests、兼容测试和游戏内验收后再删除；切换前禁止边搬边删。
- 新增游戏内手工验收文档，覆盖旧数据导入、创建/调整、双箱、分拣、满箱告警、脚本重载。
- 新增 `test:integration` 脚本，用于 Dynamic Property 兼容、端口契约和旧数据 fixture。
- `disabledContainerIds` 和 `RuntimeContainer.lastAccessFailedAt` 默认不保留为核心模型字段，除非对应 UI/诊断/故障退避用例同步落地；避免继续保留无消费者字段。
- `ownerId = ""` 的旧数据语义按“无所有者”处理，不能导致普通查询永远排除该仓库；权限用例需要显式定义 owner/admin/public 的过滤规则。
- `PreviewRescan` 必须在 UI/命令文案和 JSDoc 中标注：它会执行完整区域扫描，成本接近真实 rescan，不可高频调用。
- 双箱跨仓库边界必须显式处理：当双箱两个占用坐标只有一部分在仓库区域内时，默认以主坐标和仓库区域归属为准，并给出可诊断日志，避免静默丢失合箱更新。
- 保留当前“每个 interval 处理一个 input 容器的一个槽位”的粒度作为默认行为；是否增加每 tick 多槽处理能力必须另立性能设计，不混入本次重写。
