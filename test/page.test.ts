import { expect, vi, describe, it } from "vitest";
import { calculateNextIndex } from "../src";


describe("calculateNextIndex", () => {
    
    vi.mock("white-web-sdk");

    it("delete first page next index should be plus 1", () => {
        const nextIndex = calculateNextIndex(0, { index: 0, length: 2 });
        expect(nextIndex).toBe(1);
    });

    it("delete last page next index should be minus 1", () => {
        const nextIndex2 = calculateNextIndex(1, { index: 1, length: 2 });
        expect(nextIndex2).toBe(0);
    });

    it("delete page not equal current index, next index should equal current index", () => {
        const nextIndex3 = calculateNextIndex(1, { index: 2, length: 3 });
        expect(nextIndex3).toBe(2);
    });
});
