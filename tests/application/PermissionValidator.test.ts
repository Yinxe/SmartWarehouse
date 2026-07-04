import { describe, expect, it } from "vitest";
import { parseWarehouseId } from "../../scripts/commands/validators/ParameterParser";

describe("参数解析器", () => {
  it("标准化合法仓库名称", () => {
    const result = parseWarehouseId("My_Warehouse");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe("my_warehouse");
  });

  it("拒绝非法字符", () => {
    const result = parseWarehouseId("hello@world");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("仓库 ID");
  });

  it("拒绝超长名称", () => {
    const result = parseWarehouseId("a".repeat(40));
    expect(result.ok).toBe(false);
  });

  it("拒绝空名称", () => {
    const result = parseWarehouseId("");
    expect(result.ok).toBe(false);
  });

  it("接受短名称", () => {
    const result = parseWarehouseId("a");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe("a");
  });

  it("接受数字下划线短横线", () => {
    const result = parseWarehouseId("my-warehouse_2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe("my-warehouse_2");
  });
});
