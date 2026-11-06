import { describe, expect, it } from "vitest";
import { paragraphAtScroll } from "./scroll-sync";

describe("paragraphAtScroll", () => {
  it("selects the paragraph at the top of the visible manuscript", () => {
    expect(paragraphAtScroll([10, 125, 280], 0, 100, 500)).toBe(0);
    expect(paragraphAtScroll([10, 125, 280], 124, 100, 500)).toBe(0);
    expect(paragraphAtScroll([10, 125, 280], 125, 100, 500)).toBe(1);
    expect(paragraphAtScroll([10, 125, 280], 310, 100, 500)).toBe(2);
  });

  it("reaches the final paragraph at the bottom when it cannot scroll to the top", () => {
    expect(paragraphAtScroll([10, 125, 280], 250, 100, 350)).toBe(2);
  });

  it("uses the first paragraph when all the source fits and returns null for an empty outline", () => {
    expect(paragraphAtScroll([10, 125, 280], 0, 350, 350)).toBe(0);
    expect(paragraphAtScroll([], 0, 100, 100)).toBeNull();
  });

  it("clamps overscroll while preserving the nearest visible paragraph", () => {
    expect(paragraphAtScroll([10, 125, 280], -20, 100, 500)).toBe(0);
    expect(paragraphAtScroll([10, 125, 280], 900, 100, 500)).toBe(2);
  });
});
