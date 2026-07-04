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
