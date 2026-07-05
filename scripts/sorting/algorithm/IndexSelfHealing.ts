/**
 * 索引自愈服务 —— 领域层。
 *
 * 处理运行时 itemTypeIndex 的惰性校验和脏数据清除逻辑。
 * 不依赖 Minecraft 运行时类型，仅操作容器 ID 和状态元数据。
 *
 * ### 设计原理
 *
 * 为了提高分拣效率，系统维护了一个 itemTypeIndex 字典，
 * 键为物品类型 ID，值为包含该物品的容器 ID 列表。
 *
 * 但由于容器内的物品可能被玩家取走、容器被破坏或替换，
 * 索引可能变得"脏"（stale）。本服务采用惰性校验 + 自动修复策略：
 *
 * - 快速路径：对已有索引记录的候选容器校验有效性
 * - 回退路径：无索引记录时全量扫描所有 normal 容器
 * - 脏数据清扫：校验后从索引中移除失效条目
 * - 零延迟回退：索引全脏后立即全量扫描，不等待下一轮
 *
 * 这种设计的好处：
 * - 索引无需在物品变化时实时同步，避免了复杂的事件监听
 * - 脏数据最多影响一次查询性能，不会导致错误
 * - 全量扫描的结果被"学习"到索引中，后续分拣越来越快
 */

/**
 * 容器索引条目，记录一个物品类型关联的容器信息。
 */
export interface TypeIndexEntry {
  containerId: string;
  /** 容器角色（仅 "normal" 角色的容器进入索引） */
  role: string;
  /** 容器是否启用 */
  enabled: boolean;
}

/**
 * 自愈校验结果。
 */
export interface SelfHealingResult {
  /** 仍然有效的容器 ID 列表 */
  valid: string[];
  /** 脏数据容器 ID 集合（需要从索引清除） */
  stale: string[];
}

/**
 * 校验候选容器列表，区分有效与脏数据。
 *
 * @param candidates - 候选容器 ID 列表
 * @param containerMap - 容器 ID → 容器状态元数据的映射
 * @param typeId - 物品种类 ID（用于校验容器是否包含该类型）
 * @returns 有效和脏数据容器 ID
 */
export function validateIndexCandidates(
  candidates: string[],
  containerMap: Record<string, { role: string; enabled: boolean; containsType: (typeId: string) => boolean }>,
  typeId: string
): SelfHealingResult {
  const valid: string[] = [];
  const stale: string[] = [];

  for (const containerId of candidates) {
    const meta = containerMap[containerId];
    if (!meta) {
      stale.push(containerId);
      continue;
    }

    // 容器角色不再是 normal 或已禁用 → 脏数据
    if (meta.role !== "normal" || !meta.enabled) {
      stale.push(containerId);
      continue;
    }

    // 检查容器是否仍包含该类型
    if (meta.containsType(typeId)) {
      valid.push(containerId);
    } else {
      stale.push(containerId);
    }
  }

  return { valid, stale };
}

/**
 * 从索引中惰性清除脏条目。
 * 如果某类型下所有容器都脏了，删除整个条目。
 *
 * @param index - 物品类型 ID → 容器 ID 列表的索引
 * @param typeId - 物品种类 ID
 * @param stale - 需要清除的脏容器 ID 集合
 * @returns 更新后的索引
 */
export function cleanStaleIndexEntries(
  index: Map<string, string[]>,
  typeId: string,
  stale: Set<string>
): void {
  const candidates = index.get(typeId);
  if (!candidates) return;

  const updated = candidates.filter((id) => !stale.has(id));
  if (updated.length > 0) {
    index.set(typeId, updated);
  } else {
    index.delete(typeId);
  }
}

/**
 * 合并新发现的容器到索引中。
 *
 * @param index - 物品类型 ID → 容器 ID 列表的索引
 * @param typeId - 物品种类 ID
 * @param containerIds - 新发现的容器 ID 列表
 */
export function mergeIntoIndex(
  index: Map<string, string[]>,
  typeId: string,
  containerIds: string[]
): void {
  const existing = index.get(typeId) ?? [];
  const merged = [...new Set([...existing, ...containerIds])];
  index.set(typeId, merged);
}
