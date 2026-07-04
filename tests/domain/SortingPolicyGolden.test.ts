import { describe, expect, it } from "vitest";

type RouteLevel = "bulk" | "normal" | "family" | "autocreate" | "misc";

interface CandidateState {
  bulkNonEmptyMatching: boolean;
  normalHasType: boolean;
  familyEnabledAndMatching: boolean;
  autoCreateEnabledAndEmptyNormal: boolean;
  miscAvailable: boolean;
}

function currentRouteOrder(state: CandidateState): RouteLevel[] {
  const order: RouteLevel[] = [];
  if (state.bulkNonEmptyMatching) order.push("bulk");
  if (state.normalHasType) order.push("normal");
  if (state.familyEnabledAndMatching) order.push("family");
  if (state.autoCreateEnabledAndEmptyNormal) order.push("autocreate");
  if (state.miscAvailable) order.push("misc");
  return order;
}

describe("SortingPolicy golden behavior", () => {
  it("keeps the current route priority order", () => {
    expect(
      currentRouteOrder({
        bulkNonEmptyMatching: true,
        normalHasType: true,
        familyEnabledAndMatching: true,
        autoCreateEnabledAndEmptyNormal: true,
        miscAvailable: true,
      })
    ).toEqual(["bulk", "normal", "family", "autocreate", "misc"]);
  });

  it("routes auto-created categories before misc fallback", () => {
    expect(
      currentRouteOrder({
        bulkNonEmptyMatching: false,
        normalHasType: false,
        familyEnabledAndMatching: false,
        autoCreateEnabledAndEmptyNormal: true,
        miscAvailable: true,
      })
    ).toEqual(["autocreate", "misc"]);
  });

  it("does not let empty bulk containers claim new item types", () => {
    expect(
      currentRouteOrder({
        bulkNonEmptyMatching: false,
        normalHasType: true,
        familyEnabledAndMatching: false,
        autoCreateEnabledAndEmptyNormal: false,
        miscAvailable: true,
      })[0]
    ).toBe("normal");
  });
});
