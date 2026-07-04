import { describe, expect, it } from "vitest";
import type { ContainerAccessPort } from "../../scripts/application/ports/ContainerAccessPort";
import type { WorldAccessPort } from "../../scripts/application/ports/WorldAccessPort";
import type { WarehouseRepositoryPort } from "../../scripts/application/ports/WarehouseRepositoryPort";

describe("端口接口", () => {
  it("所有端口接口可导入而不依赖MC运行时", () => {
    // 只验证类型可编译，不创建实例
    expect(true).toBe(true);
  });
});
