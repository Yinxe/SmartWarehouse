// 这里冻结当前目标容器回滚 helper；DDD 重写必须按设计规格补上输入槽快照覆盖。

import { describe, expect, it } from "vitest";
import { MockContainer, MockItemStack } from "../helpers/MockMinecraft";
import { MoveJournal } from "../../scripts/sorting/io/MoveJournal";
import { tryMoveStackIntoContainerWithJournal } from "../../scripts/sorting/io/ContainerAccess";

describe("输入堆栈事务契约", () => {
  it("可回滚MoveJournal记录的目标容器写入", () => {
    const target = new MockContainer(2, [new MockItemStack("minecraft:stone", 60), undefined]);
    const journal = new MoveJournal();

    const remaining = tryMoveStackIntoContainerWithJournal(
      new MockItemStack("minecraft:stone", 8) as any,
      target as any,
      journal,
      "target-1"
    );

    expect(remaining).toBeUndefined();
    expect(target.dump()).toEqual([
      { typeId: "minecraft:stone", amount: 64 },
      { typeId: "minecraft:stone", amount: 4 },
    ]);

    const rollback = journal.rollback();
    expect(rollback.ok).toBe(true);
    expect(target.dump()).toEqual([{ typeId: "minecraft:stone", amount: 60 }, undefined]);
  });

  it("模拟输入槽提交失败", () => {
    const input = new MockContainer(1, [new MockItemStack("minecraft:diamond", 3)]);
    input.failSetSlots.add(0);

    expect(() => input.setItem(0, undefined)).toThrow("setItem failed at slot 0");
    expect(input.dump()).toEqual([{ typeId: "minecraft:diamond", amount: 3 }]);
  });
});
