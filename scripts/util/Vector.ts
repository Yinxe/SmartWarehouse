/**
 * 坐标与区域工具函数。
 *
 * 纯数学运算已迁移到 scripts/domain/shared/Vector.ts，
 * 此处保持为转发 re-export 以确保现有导入不受影响。
 */
export {
  locationKey,
  normalizeArea,
  areaVolume,
  isNearAreaXZ,
  isInsideArea,
  compareLocationForPrimary,
  areasTooClose,
} from "../domain/shared/Vector";
