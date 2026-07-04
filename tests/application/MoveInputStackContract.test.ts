// 这里冻结当前目标容器回滚 helper；DDD 重写必须按设计规格补上输入槽快照覆盖。

import { describe, expect, it } from "vitest";
import { MockContainer, MockItemStack } from "../helpers/MockMinecraft";
import { MoveJournal } from "../../scripts/sorting/MoveJournal";
import { tryMoveStackIntoContainerWithJournal } from "../../scripts/sorting/ContainerInventory";

describe("Move input stack transaction contract", () => {
  it("can roll back target container writes recorded by MoveJournal", () => {
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

  it("models input slot commit failure for the rewrite contract", () => {
    const input = new MockContainer(1, [new MockItemStack("minecraft:diamond", 3)]);
    input.failSetSlots.add(0);

    expect(() => input.setItem(0, undefined)).toThrow("setItem failed at slot 0");
    expect(input.dump()).toEqual([{ typeId: "minecraft:diamond", amount: 3 }]);
  });
});
