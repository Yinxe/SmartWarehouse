import { describe, expect, it } from "vitest";
import { computeRouteOrder } from "../../scripts/domain/sorting/SortingPolicy";

describe("SortingPolicy golden behavior", () => {
  it("keeps the current route priority order", () => {
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

  it("routes auto-created categories before misc fallback", () => {
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

  it("does not let empty bulk containers claim new item types", () => {
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
