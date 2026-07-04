/**
 * 容器类型识别规则 —— 领域层。
 *
 * 定义智能仓库支持的容器类型分类逻辑。
 * 不依赖 Minecraft 运行时 API，可直接在测试中使用。
 */

/** 所有支持颜色的潜影盒类型 ID 集合 */
export const SHULKER_BOX_IDS = new Set([
  "minecraft:undyed_shulker_box",
  "minecraft:shulker_box",
  "minecraft:white_shulker_box",
  "minecraft:orange_shulker_box",
  "minecraft:magenta_shulker_box",
  "minecraft:light_blue_shulker_box",
  "minecraft:yellow_shulker_box",
  "minecraft:lime_shulker_box",
  "minecraft:pink_shulker_box",
  "minecraft:gray_shulker_box",
  "minecraft:light_gray_shulker_box",
  "minecraft:cyan_shulker_box",
  "minecraft:purple_shulker_box",
  "minecraft:blue_shulker_box",
  "minecraft:brown_shulker_box",
  "minecraft:green_shulker_box",
  "minecraft:red_shulker_box",
  "minecraft:black_shulker_box",
]);

/** 单个箱子的最大槽位数（非双箱）。双箱的槽位数为 54，超过此值即为双箱。 */
export const SINGLE_CHEST_SIZE = 27;

/**
 * 判断给定的方块类型 ID 是否为箱子或陷阱箱。
 * 只有这两种箱子才需要双箱（大箱子）检测逻辑。
 */
export function isChestType(typeId: string): boolean {
  return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest";
}

/**
 * 判断给定的方块类型 ID 是否为漏斗。
 * 漏斗是特殊的输入容器，自动分配 "input" 角色且不可改为存储角色。
 */
export function isHopperType(typeId: string): boolean {
  return typeId === "minecraft:hopper";
}

/**
 * 判断给定方块类型 ID 是否为智能仓库支持的容器类型。
 * 当前支持：箱子、陷阱箱、桶、漏斗以及所有颜色的潜影盒。
 */
export function isSupportedContainerType(typeId: string): boolean {
  return isChestType(typeId) || isHopperType(typeId) || typeId === "minecraft:barrel" || SHULKER_BOX_IDS.has(typeId);
}

/**
 * 根据容器尺寸判断是否为双箱（大箱子）。
 */
export function isDoubleChestSize(containerSize: number): boolean {
  return containerSize > SINGLE_CHEST_SIZE;
}

/**
 * 判断容器角色是否需要强制锁定。
 * 漏斗始终为 input 角色，不可改为存储角色。
 */
export function getForcedRole(
  blockTypeId: string,
  existingRole: string | undefined,
  defaultRole: string
): string {
  if (isHopperType(blockTypeId)) return "input";
  return existingRole ?? defaultRole;
}
