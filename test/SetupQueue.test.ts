import { describe, expect, it } from "vitest";

import { SetupQueue } from "../src/Utils/SetupQueue";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe("SetupQueue", () => {
    it("runs tasks strictly one at a time (no overlapping executions)", async () => {
        const queue = new SetupQueue();
        const events: string[] = [];

        const makeTask = (name: string, ms: number) => async () => {
            events.push(`start:${name}`);
            await delay(ms);
            events.push(`end:${name}`);
        };

        await Promise.all([
            queue.push("a", () => 0, makeTask("a", 20)),
            queue.push("b", () => 0, makeTask("b", 5)),
            queue.push("c", () => 0, makeTask("c", 1)),
        ]);

        expect(events).toEqual([
            "start:a",
            "end:a",
            "start:b",
            "end:b",
            "start:c",
            "end:c",
        ]);
    });

    it("prefers the lowest priority value and keeps insertion order for ties", async () => {
        const queue = new SetupQueue();
        const order: string[] = [];
        const release: Array<() => void> = [];
        const first = queue.push("first", () => 5, async () => {
            order.push("first");
            // Block the queue until every other task has been enqueued.
            await new Promise<void>(resolve => release.push(resolve));
        });
        const pending = [
            queue.push("low", () => 10, async () => void order.push("low")),
            queue.push("high", () => 1, async () => void order.push("high")),
            queue.push("mid", () => 5, async () => void order.push("mid")),
        ];
        while (release.length === 0) {
            await delay(1);
        }
        release[0]();
        await Promise.all([first, ...pending]);

        expect(order).toEqual(["first", "high", "mid", "low"]);
    });

    it("evaluates priority at pick time so pending tasks follow focus changes", async () => {
        const queue = new SetupQueue();
        const order: string[] = [];
        let focused = "a";
        const priorityOf = (id: string) => (focused === id ? 0 : 10);

        const release: Array<() => void> = [];
        const first = queue.push("running", () => 0, async () => {
            await new Promise<void>(resolve => release.push(resolve));
        });
        const a = queue.push("a", () => priorityOf("a"), async () => void order.push("a"));
        const b = queue.push("b", () => priorityOf("b"), async () => void order.push("b"));

        // Focus changes to b before the running task finishes.
        focused = "b";
        release[0]();
        await Promise.all([first, a, b]);

        expect(order).toEqual(["b", "a"]);
    });

    it("rejects cancelled tasks only while they are still pending", async () => {
        const queue = new SetupQueue();
        const order: string[] = [];
        const release: Array<() => void> = [];
        const first = queue.push("running", () => 0, async () => {
            await new Promise<void>(resolve => release.push(resolve));
        });
        const keep = queue.push("keep", () => 5, async () => void order.push("keep"));
        const drop = queue.push("drop", () => 5, async () => void order.push("drop"));

        expect(queue.cancel("drop")).toBe(true);
        expect(queue.cancel("drop")).toBe(false);
        release[0]();
        await expect(drop).rejects.toThrow("cancelled");
        await Promise.all([first, keep]);

        expect(order).toEqual(["keep"]);
    });

    it("lets an active setup finish before the latest remote focus target starts", async () => {
        const queue = new SetupQueue();
        const order: string[] = [];
        let finishActive!: () => void;
        const active = queue.push("setup:c", () => 0, async () => {
            order.push("start:c");
            await new Promise<void>(resolve => {
                finishActive = resolve;
            });
            order.push("end:c");
        });
        const latestRemote = queue.push("setup:e", () => 0, async () => {
            order.push("start:e");
        });

        expect(queue.cancel("setup:c")).toBe(false);
        expect(order).toEqual(["start:c"]);
        finishActive();
        await Promise.all([active, latestRemote]);

        expect(order).toEqual(["start:c", "end:c", "start:e"]);
    });

    it("whenIdle resolves once the queue is drained", async () => {
        const queue = new SetupQueue();
        let done = false;
        const idleBefore = await queue.whenIdle();
        expect(idleBefore).toBeUndefined();

        const task = queue.push("t", () => 0, async () => {
            await delay(5);
            done = true;
        });
        await queue.whenIdle();
        expect(done).toBe(true);
        await task;
    });
});
