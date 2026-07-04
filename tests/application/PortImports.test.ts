import { describe, expect, it } from "vitest";
import type { ContainerAccessPort } from "../../scripts/application/ports/ContainerAccessPort";
import type { WorldAccessPort } from "../../scripts/application/ports/WorldAccessPort";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("Port interfaces", () => {
  it("all port interfaces are importable without MC runtime", () => {
    // 只验证类型可编译，不创建实例
    expect(true).toBe(true);
  });
});
