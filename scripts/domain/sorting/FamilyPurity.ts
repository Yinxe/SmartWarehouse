/**
 * 家族纯度排序服务 —— 领域层。
 *
 * 家族纯度 = 容器中属于目标家族的物品种类数 ÷ 容器中所有物品种类总数。
 *
 * 分数范围 [0, 1]：
 * - 1.0 = 容器中只有该家族的物品（最纯，优先选择）
 * - 0.0 = 容器中没有该家族的物品
 *
 * 家族分拣时对候选容器按纯度降序排列，让物品优先流入更"专一"的容器，
 * 避免已混杂多个家族的容器承受过大的物品压力。
 */

/**
 * 容器内物品的快照视图（纯数据，不依赖 Minecraft 容器类型）。
 */
export interface ContainerContent {
  /** 容器中所有物品种类 ID 的集合 */
  typeIds: Set<string>;
}

/**
 * 计算容器对于指定家族的纯度分数。
 *
 * @param content - 容器内容快照（纯数据）
 * @param familyMemberSet - 目标家族的所有物品 typeId 集合
 * @returns 纯度分数 [0, 1]
 */
export function calculateFamilyPurity(
  content: ContainerContent,
  familyMemberSet: Set<string>
): number {
  const { typeIds } = content;

  if (typeIds.size === 0) return 0;

  let targetCount = 0;
  for (const typeId of typeIds) {
    if (familyMemberSet.has(typeId)) {
      targetCount++;
    }
  }

  return targetCount / typeIds.size;
}

/**
 * 按家族纯度对候选容器降序排序。
 *
 * 纯度越高的容器越优先接收物品，使得家族物品自然流入更"专一"的容器。
 * 同纯度时保持原始索引以保持确定性。
 *
 * @param containerIds - 候选容器 ID 列表
 * @param getContent - 根据容器 ID 获取容器内容的函数
 * @param familyMemberSet - 目标家族物品 typeId 集合
 * @returns 按纯度降序排序后的容器 ID 列表
 */
export function sortByFamilyPurity(
  containerIds: string[],
  getContent: (id: string) => ContainerContent | undefined,
  familyMemberSet: Set<string>
): string[] {
  if (containerIds.length <= 1) return containerIds;

  const scored: { id: string; purity: number; index: number }[] = [];
  let hasPositivePurity = false;

  for (let i = 0; i < containerIds.length; i++) {
    const containerId = containerIds[i];
    const content = getContent(containerId);
    if (!content) {
      scored.push({ id: containerId, purity: 0, index: i });
      continue;
    }
    const purity = calculateFamilyPurity(content, familyMemberSet);
    if (purity > 0) hasPositivePurity = true;
    scored.push({ id: containerId, purity, index: i });
  }

  // 全部候选不可达或纯度均为 0 → 无需排序
  if (!hasPositivePurity) return containerIds;

  // 降序排列；同纯度时按原始索引保持稳定
  scored.sort((a, b) => b.purity - a.purity || a.index - b.index);
  return scored.map((s) => s.id);
}
