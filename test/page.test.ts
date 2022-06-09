import { expect, test, vi } from "vitest";
import { calculateNextIndex } from "../src";

vi.mock("white-web-sdk");

test("calculateNextIndex", () => {
    const nextIndex = calculateNextIndex(0, { index: 0, length: 2 });
    expect(nextIndex).toBe(1);

    const nextIndex2 = calculateNextIndex(1, { index: 0, length: 2 });
    expect(nextIndex2).toBe(0);

    const nextIndex3 = calculateNextIndex(1, { index: 2, length: 3 });
    expect(nextIndex3).toBe(2);

    const nextIndex4 = calculateNextIndex(2, { index: 2, length: 3 });
    expect(nextIndex4).toBe(1);
});
