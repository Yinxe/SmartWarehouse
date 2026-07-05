import { describe, expect, it } from "vitest";
import { computeRouteOrder } from "../../scripts/sorting/SortingPolicy";

describe("排序策略黄金行为", () => {
  it("保持当前的路由优先级顺序", () => {
    expect(
      computeRouteOrder({
        bulkNonEmptyMatching: true,
        normalHasType: true,
        familyEnabledAndMatching: true,
        autoCreateEnabledAndEmptyNormal: true,
        miscAvailable: true,
      })
    ).toEqual(["bulk", "normal", "family", "autocreate", "misc"]);
  });

  it("自动分类在杂项兜底之前路由", () => {
    expect(
      computeRouteOrder({
        bulkNonEmptyMatching: false,
        normalHasType: false,
        familyEnabledAndMatching: false,
        autoCreateEnabledAndEmptyNormal: true,
        miscAvailable: true,
      })
    ).toEqual(["autocreate", "misc"]);
  });

  it("空大宗容器不认领新物品种类", () => {
    expect(
      computeRouteOrder({
        bulkNonEmptyMatching: false,
        normalHasType: true,
        familyEnabledAndMatching: false,
        autoCreateEnabledAndEmptyNormal: false,
        miscAvailable: true,
      })[0]
    ).toBe("normal");
  });
});
