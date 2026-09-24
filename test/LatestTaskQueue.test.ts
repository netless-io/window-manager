import { afterEach, describe, expect, it, vi } from "vitest";
import { LatestTaskQueue } from "../src/Utils/LatestTaskQueue";
import { SetupQueue } from "../src/Utils/SetupQueue";

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fixture() {
    vi.useFakeTimers();
    let visible = true;
    let minimized = false;
    const calls: string[] = [];
    const yielded = vi.fn();
    const queue = new LatestTaskQueue<string>({
        timeout: 10_000,
        runnable: () => visible && !minimized,
        canYield: (a, b) => a !== b,
        startedAt: () => undefined,
        yield: yielded,
        error: error => { throw error; },
    });
    const push = (id: string, work = Promise.resolve()) => queue.push(id, async () => {
        calls.push(id);
        await work;
    });
    return { queue, push, calls, yielded, visibility(value: boolean) { visible = value; queue.wake(); },
        minimize(value: boolean) { minimized = value; queue.wake(); } };
}

afterEach(() => vi.useRealTimers());
describe("latest pending setup", () => {
    it("runs only A and latest E, after A normally completes", async () => {
        const f = fixture(); const a = deferred();
        f.push("A", a.promise); await flush();
        f.push("B"); f.push("C"); f.push("D"); const e = f.push("E");
        await flush(); expect(f.calls).toEqual(["A"]);
        a.resolve(); await flush(); await e;
        expect(f.calls).toEqual(["A", "E"]); expect(f.yielded).not.toHaveBeenCalled();
    });
    it("does not yield without pending; a later request uses the original deadline", async () => {
        const f = fixture(); const a = deferred();
        f.push("A", a.promise); await flush();
        vi.advanceTimersByTime(12_000); expect(f.yielded).not.toHaveBeenCalled();
        const e = f.push("E"); await flush(); await e;
        expect(f.yielded).toHaveBeenCalledOnce(); expect(f.calls).toEqual(["A", "E"]);
        a.resolve(); await flush();
    });
    it("keeps writing pending while hidden and resumes with only the remaining four seconds", async () => {
        const f = fixture(); const a = deferred();
        f.push("A", a.promise); await flush(); f.visibility(false);
        f.push("B"); f.push("C"); const e = f.push("E");
        vi.advanceTimersByTime(6_000); f.visibility(true); await flush();
        expect(f.calls).toEqual(["A"]);
        vi.advanceTimersByTime(3_999); await flush(); expect(f.calls).toEqual(["A"]);
        vi.advanceTimersByTime(1); await flush(); await e;
        expect(f.calls).toEqual(["A", "E"]); a.resolve(); await flush();
    });
    it("requires both visibility and unminimize; after 12s resume starts latest immediately", async () => {
        const f = fixture(); const a = deferred();
        f.push("A", a.promise); await flush(); f.minimize(true); f.visibility(false);
        f.push("B"); const e = f.push("E"); vi.advanceTimersByTime(12_000);
        f.visibility(true); await flush(); expect(f.calls).toEqual(["A"]);
        f.minimize(false); await flush(); await e;
        expect(f.calls).toEqual(["A", "E"]); a.resolve(); await flush();
    });
    it("does not lose pending when A finishes in the background", async () => {
        const f = fixture(); const a = deferred();
        f.push("A", a.promise); await flush(); f.visibility(false);
        const e = f.push("E"); a.resolve(); await flush();
        expect(f.calls).toEqual(["A"]); f.visibility(true); await flush(); await e;
        expect(f.calls).toEqual(["A", "E"]);
    });
    it("late A completion cannot free E's slot and start F early", async () => {
        const f = fixture(); const a = deferred(); const e = deferred();
        f.push("A", a.promise); await flush(); f.push("E", e.promise);
        vi.advanceTimersByTime(10_000); await flush(); const end = f.push("F");
        a.resolve(); await flush(); expect(f.calls).toEqual(["A", "E"]);
        e.resolve(); await flush(); await end; expect(f.calls).toEqual(["A", "E", "F"]);
    });
    it("a hidden idle queue does not consume a request", async () => {
        const f = fixture(); f.visibility(false); const e = f.push("E");
        await flush(); expect(f.calls).toEqual([]); f.visibility(true); await flush(); await e;
        expect(f.calls).toEqual(["E"]);
    });
    it("removes only a matching pending target without cancelling active work", async () => {
        const f = fixture(); const a = deferred();
        f.push("A", a.promise); await flush();
        const b = f.push("B");
        expect(f.queue.cancelPending(id => id === "E")).toBe(false);
        expect(f.queue.cancelPending(id => id === "B")).toBe(true);
        await b;
        const e = f.push("E");
        vi.advanceTimersByTime(10_000); await flush(); await e;
        expect(f.calls).toEqual(["A", "E"]);
        a.resolve(); await flush();
    });
});

it("yielded setup keeps its real promise and cannot release the next physical lease", async () => {
    const queue = new SetupQueue(); const a = deferred(); const e = deferred();
    let aDone = false; const calls: string[] = [];
    const old = queue.push("setup:A", () => 0, async () => { calls.push("A"); await a.promise; });
    void old.then(() => { aDone = true; });
    queue.yieldSetup();
    const next = queue.push("setup:E", () => 0, async () => { calls.push("E"); await e.promise; });
    const final = queue.push("setup:F", () => 0, async () => { calls.push("F"); });
    await flush(); expect(aDone).toBe(false);
    a.resolve(); await old; await flush(); expect(calls).toEqual(["A", "E"]);
    e.resolve(); await next; await final; expect(calls).toEqual(["A", "E", "F"]);
});
