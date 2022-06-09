import { describe, vi, it, expect, afterEach } from "vitest";
import { AppCreateQueue } from "../../src/Utils/AppCreateQueue";
import { wait } from "../../src/Utils/Common";
import { callbacks } from "../../src/callback";

describe("AppCreateQueue", () => {
    
    vi.mock("white-web-sdk");
    vi.mock("../../src/callback", () => {
        return { callbacks: { emit: vi.fn() } };
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it("push should invoke and emit ready", async () => {
        const queue = new AppCreateQueue();
        const fn = vi.fn().mockResolvedValue(undefined);
        const fn2 = vi.fn().mockResolvedValue(undefined);
        queue.push(fn);
        queue.push(fn2);

        expect(fn).toBeCalled();
        await wait(50);
        expect(fn2).toBeCalled();
        await wait(50);
        expect(callbacks.emit).toBeCalledWith("ready");
    });

    it("empty should clear queue", async () => {
        const queue = new AppCreateQueue();

        const fn = vi.fn().mockResolvedValue(undefined);
        const fn2 = vi.fn().mockResolvedValue(undefined);
        queue.push(fn);
        queue.push(fn2);

        expect(fn).toBeCalled();
        queue.empty();
        await wait(50);
        expect(fn2).not.toBeCalled();
    });
});
