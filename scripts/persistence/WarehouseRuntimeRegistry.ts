import type { WarehouseId, WarehouseData } from "../types";
import { buildWarehouseRuntimeModel, type WarehouseRuntimeModel } from "../warehouse/WarehouseRuntimeModel";

export class WarehouseRuntimeRegistry {
  private readonly models = new Map<WarehouseId, WarehouseRuntimeModel>();

  constructor(
    private readonly loadWarehouse: (id: WarehouseId) => WarehouseData | undefined
  ) {}

  getOrBuild(id: WarehouseId): WarehouseRuntimeModel | undefined {
    const existing = this.models.get(id);
    if (existing && !existing.dirty) return existing;

    const warehouse = this.loadWarehouse(id);
    if (!warehouse) return undefined;

    const model = buildWarehouseRuntimeModel(warehouse);
    const oldCursor = existing?.inputCursor ?? 0;
    model.inputCursor = model.inputContainerIds.length > 0 ? oldCursor % model.inputContainerIds.length : 0;
    this.models.set(id, model);
    return model;
  }

  markDirty(id: WarehouseId): void {
    const model = this.models.get(id);
    if (model) model.dirty = true;
  }

  delete(id: WarehouseId): void {
    this.models.delete(id);
  }
}
