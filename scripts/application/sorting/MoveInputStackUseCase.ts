/**
 * 输入槽分拣用例（骨架）。
 *
 * 后续将承接 SorterEngine.processInputContainer 的逻辑，
 * 当前仅定义接口占位。
 */

export class MoveInputStackUseCase {
  execute(params: { warehouseId: string }): { processed: boolean } {
    return { processed: false };
  }
}
