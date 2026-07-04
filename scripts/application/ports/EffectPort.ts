/**
 * 视觉/粒子效果端口。
 *
 * 定义分拣和整理操作的视觉效果触发接口。
 */

export interface EffectPort {
  playSortEffect(dimensionId: string, locations: unknown[], role: string): void;
  playOrganizeEffect(dimensionId: string, location: unknown): void;
}
