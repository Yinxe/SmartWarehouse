/**
 * 仓库运行时模型 —— 领域定义与构建函数。
 *
 * 运行时模型（WarehouseRuntimeModel）在持久化数据（WarehouseData）之上添加了
 * 便于高效查询的索引结构（Map、按角色分类的 ID 列表等），仅存在于内存中，不会被持久化。
 *
 * 本文件属于 Domain 层：允许使用 ItemStack 和项目值对象，
 * 但不依赖 Container/Block/Dimension/world/system 等 Minecraft 运行时类型。
 */

import type { ContainerId, WarehouseId, WarehouseData, StoredContainer } from "../../types";
import { makeOccupiedLocationKey } from "../../warehouse/ContainerId";

/**
 * 运行时容器信息，在 StoredContainer 基础上增加了运行时状态字段。
 * 用于追踪容器在运行时的访问状态，不持久化到磁盘。
 */
export interface RuntimeContainer extends StoredContainer {
  /** 上一次访问失败的 tick 时间戳，用于失败重试和故障检测 */
  lastAccessFailedAt?: number;
}

/**
 * 构建仓库运行时模型接口（不包含容器索引）。
 */
export interface WarehouseRuntimeModel {
  /** 仓库 ID */
  warehouseId: WarehouseId;
  /** 容器 ID → 运行时容器的映射 */
  containersById: Map<ContainerId, RuntimeContainer>;
  /** 位置键（dimensionId|x|y|z）→ 容器 ID 的映射，用于快速通过坐标查找容器 */
  occupiedLocationIndex: Map<string, ContainerId>;
  /** 角色为 "input" 的容器 ID 列表 */
  inputContainerIds: ContainerId[];
  /** 角色为 "normal" 的容器 ID 列表 */
  normalContainerIds: ContainerId[];
  /** 角色为 "misc" 的容器 ID 列表 */
  miscContainerIds: ContainerId[];
  /** 角色为 "bulk" 的容器 ID 列表 */
  bulkContainerIds: ContainerId[];
  /** 角色为 "disabled" 的容器 ID 列表 */
  disabledContainerIds: ContainerId[];
  /**
   * 物品类型 → 容器 ID 列表的索引。
   * 用于快速找到存储特定物品类型的容器，key 为物品类型 ID。
   */
  itemTypeIndex: Map<string, ContainerId[]>;

  /**
   * 同族物品分类 → 容器 ID 列表的索引。
   * 用于快速找到存储某个同族分类物品的容器，key 为族 ID。
   * 由分拣引擎在放置物品时惰性构建。
   */
  familyTypeIndex: Map<string, ContainerId[]>;

  /**
   * 轮询游标，用于在 input 容器之间轮询分配存入任务，
   * 避免总是使用同一个容器造成热点。
   */
  inputCursor: number;

  /**
   * 每个输入容器当前处理的槽位游标（容器 ID → 槽位索引）。
   * 每次 interval 仅处理该游标指向的一个槽位，处理完毕后游标 +1。
   * 当游标超出容器大小时回绕到 0。
   */
  inputSlotCursors: Map<ContainerId, number>;
  /** 最后一次重建索引的游戏刻时间戳 */
  lastBuiltAt: number;
  /** 空闲状态（所有输入容器空时置 true，跳过调度） */
  idle: boolean;
  /**
   * "脏"标记。当仓库数据发生变更时设为 true，
   * 触发按需重建运行时索引，避免每次操作都重建。
   */
  dirty: boolean;

  /**
   * 上一次检查仓库区域所在区块是否已加载的游戏刻。
   * 每 40 tick 约 2 秒检查一次，避免每 tick 都采样。
   */
  areaLoadedCheckedTick: number;

  /**
   * 缓存的上一次区域加载检查结果。
   * - `true`：所有采样点均位于已加载区块
   * - `false`：至少有一个采样点在未加载区块
   * - `undefined`：尚未检查
   */
  areaLoaded: boolean | undefined;
}

/**
 * 根据仓库持久化数据构建运行时模型。
 *
 * 运行时模型在持久化数据之上添加了便于高效查询的索引结构，
 * 仅存在于内存中，不会被持久化。
 *
 * @param warehouse 从仓库仓储层加载的持久化数据
 * @returns 构建好的运行时模型，包含各种优化索引
 */
export function buildWarehouseRuntimeModel(warehouse: WarehouseData): WarehouseRuntimeModel {
  const model: WarehouseRuntimeModel = {
    warehouseId: warehouse.id,
    containersById: new Map(),
    occupiedLocationIndex: new Map(),
    inputContainerIds: [],
    normalContainerIds: [],
    miscContainerIds: [],
    bulkContainerIds: [],
    disabledContainerIds: [],
    itemTypeIndex: new Map<string, ContainerId[]>(),
    familyTypeIndex: new Map<string, ContainerId[]>(),
    inputCursor: 0,
    inputSlotCursors: new Map(),
    lastBuiltAt: Date.now(),
    dirty: false,
    areaLoadedCheckedTick: 0,
    areaLoaded: undefined,
    idle: false,
  };

  for (const container of Object.values(warehouse.containers)) {
    // 深拷贝容器对象中的 occupiedLocations 数组，防止对持久化数据的无意识修改
    model.containersById.set(container.id, { ...container, occupiedLocations: [...container.occupiedLocations] });
    for (const location of container.occupiedLocations) {
      const locationKey = makeOccupiedLocationKey(container.dimensionId, location);
      // occupiedLocationIndex 是世界坐标到容器的 1:1 映射，重复键意味着容器定义重叠。
      // 在正确的扫描器下不应发生 —— 此处打印警告并跳过，保留先注册的容器。
      if (model.occupiedLocationIndex.has(locationKey)) {
        console.warn(
          `[SmartWarehouse] 发现重复的已占用位置 ${locationKey}：容器 ${model.occupiedLocationIndex.get(locationKey)} 已注册，跳过 ${container.id}`
        );
        continue;
      }
      model.occupiedLocationIndex.set(locationKey, container.id);
    }
    // 按启用状态和角色分类归入不同列表
    if (!container.enabled) {
      model.disabledContainerIds.push(container.id);
    } else if (container.role === "input") model.inputContainerIds.push(container.id);
    else if (container.role === "normal") model.normalContainerIds.push(container.id);
    else if (container.role === "misc") model.miscContainerIds.push(container.id);
    else if (container.role === "bulk") model.bulkContainerIds.push(container.id);
  }

  return model;
}
