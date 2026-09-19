import { describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk");

import { AppManager } from "../src/AppManager";
import { SetupQueue } from "../src/Utils/SetupQueue";
import { normalizeMaxCachedAppsInMaximizedMode } from "../src";

const createLazyManager = (maxCachedApps = 1) => {
    const warnings: string[] = [];
    const manager = Object.create(AppManager.prototype) as any;
    manager.windowManger = {
        lazySetupInMaximizedMode: true,
        maxCachedAppsInMaximizedMode: maxCachedApps,
        Logger: {
            info: (message: string) => warnings.push(`[info] ${message}`),
            warn: (message: string) => warnings.push(message),
            error: (message: string) => warnings.push(`[error] ${message}`),
        },
        attributes: { apps: {}, minimized: false },
    };
    manager.store = { focus: undefined };
    manager.lruClock = 0;
    manager.setupTaskQueue = new SetupQueue();
    manager.runtimeCache = new Map();
    manager.settingUpApps = new Map();
    manager.activeLazyAppId = undefined;
    manager.warnings = warnings;
    return manager;
};

const createProxy = (
    overrides: Partial<{ isSetup: boolean; canTeardown: boolean }> = {},
) => ({
    isDestroyed: false,
    isSetup: overrides.isSetup ?? false,
    canTeardown: overrides.canTeardown ?? true,
    ensureSetup: vi.fn().mockResolvedValue(undefined),
    teardown: vi.fn().mockResolvedValue(undefined),
});

describe("normalizeMaxCachedAppsInMaximizedMode", () => {
    it.each([
        [undefined, 1],
        [0, 1],
        [-3, 1],
        [2.5, 1],
        [Number.NaN, 1],
        [Infinity, 1],
        [1, 1],
        [5, 5],
    ])("normalizes %s to %s", (value, expected) => {
        const warnings: string[] = [];
        const result = normalizeMaxCachedAppsInMaximizedMode(
            value as number | undefined,
            true,
            message => warnings.push(message)
        );
        expect(result).toBe(expected);
        if (expected === 1 && value !== undefined && value !== 1) {
            expect(warnings).toHaveLength(1);
        }
    });

    it("warns about suspiciously large caches but keeps the value", () => {
        const warnings: string[] = [];
        const result = normalizeMaxCachedAppsInMaximizedMode(
            20,
            true,
            message => warnings.push(message)
        );
        expect(result).toBe(20);
        expect(warnings).toHaveLength(1);
    });

    it("ignores the value when lazy setup is not requested", () => {
        const warnings: string[] = [];
        const result = normalizeMaxCachedAppsInMaximizedMode(
            0.5,
            false,
            message => warnings.push(message)
        );
        expect(result).toBe(1);
        expect(warnings).toHaveLength(0);
    });
});

describe("AppManager lazy runtime cache", () => {
    it("dedupes concurrent setup requests into one queued task", async () => {
        const manager = createLazyManager(5);
        const proxy = createProxy();
        manager.appProxies = new Map([["app-1", proxy]]);

        const first = AppManager.prototype.enqueueAppSetup.call(manager, "app-1");
        const second = AppManager.prototype.enqueueAppSetup.call(manager, "app-1");
        expect(first).toBe(second);
        await Promise.all([first, second]);

        expect(proxy.ensureSetup).toHaveBeenCalledTimes(1);
        expect(manager.settingUpApps.size).toBe(0);
        expect(manager.runtimeCache.get("app-1")?.state).toBe("ready");
    });

    it("does not re-setup a cached app and refreshes its LRU time", async () => {
        const manager = createLazyManager(5);
        const proxy = createProxy({ isSetup: true });
        manager.appProxies = new Map([["app-1", proxy]]);
        manager.runtimeCache.set("app-1", { lastUsed: 0, state: "ready" });

        await AppManager.prototype.enqueueAppSetup.call(manager, "app-1");

        expect(proxy.ensureSetup).not.toHaveBeenCalled();
        expect(manager.runtimeCache.get("app-1")?.lastUsed).toBeGreaterThan(0);
    });

    it("drops the cache slot when setup fails", async () => {
        const manager = createLazyManager(5);
        const proxy = createProxy();
        proxy.ensureSetup = vi.fn().mockRejectedValue(new Error("boom"));
        manager.appProxies = new Map([["app-1", proxy]]);

        await expect(
            AppManager.prototype.enqueueAppSetup.call(manager, "app-1")
        ).rejects.toThrow("boom");

        expect(manager.runtimeCache.has("app-1")).toBe(false);
    });

    it("evicts the LRU runtime before a cache-miss setup when the cache overflows", async () => {
        const manager = createLazyManager(2);
        const oldest = createProxy({ isSetup: true });
        const newer = createProxy({ isSetup: true });
        manager.appProxies = new Map([
            ["oldest", oldest],
            ["newer", newer],
        ]);
        manager.runtimeCache.set("oldest", { lastUsed: 1, state: "ready" });
        manager.runtimeCache.set("newer", { lastUsed: 2, state: "ready" });

        await AppManager.prototype.evictBeforeSetup.call(manager, "incoming");

        expect(oldest.teardown).toHaveBeenCalledTimes(1);
        expect(newer.teardown).not.toHaveBeenCalled();
        expect(manager.runtimeCache.has("oldest")).toBe(false);
        expect(manager.runtimeCache.has("newer")).toBe(true);
    });

    it("never evicts the visible active app before its successor is ready", async () => {
        const manager = createLazyManager(1);
        const active = createProxy({ isSetup: true });
        manager.appProxies = new Map([["active", active]]);
        manager.runtimeCache.set("active", { lastUsed: 1, state: "ready" });
        manager.activeLazyAppId = "active";

        await AppManager.prototype.evictBeforeSetup.call(manager, "next");

        expect(active.teardown).not.toHaveBeenCalled();
        expect(manager.runtimeCache.has("active")).toBe(true);
    });

    it("keeps the cache slot of apps without a teardown implementation", async () => {
        const manager = createLazyManager(2);
        const zombie = createProxy({ isSetup: true });
        zombie.canTeardown = false;
        manager.appProxies = new Map([["zombie", zombie]]);
        manager.runtimeCache.set("zombie", { lastUsed: 1, state: "ready" });

        // eviction targets the zombie (oldest) but must skip and keep it
        await AppManager.prototype.evictBeforeSetup.call(manager, "incoming");

        expect(zombie.teardown).not.toHaveBeenCalled();
        expect(manager.runtimeCache.get("zombie")?.state).toBe("ready");
    });

    it("orders LRU by a monotonic access counter, immune to same-ms touches", async () => {
        const manager = createLazyManager(3);
        const a = createProxy({ isSetup: true });
        const b = createProxy({ isSetup: true });
        manager.appProxies = new Map([
            ["a", a],
            ["b", b],
        ]);
        manager.runtimeCache.set("a", { lastUsed: 0, state: "ready" });
        manager.runtimeCache.set("b", { lastUsed: 0, state: "ready" });

        // two touches in the same millisecond - wall clock would tie here
        AppManager.prototype.touchRuntime.call(manager, "a");
        AppManager.prototype.touchRuntime.call(manager, "b");

        const la = manager.runtimeCache.get("a").lastUsed;
        const lb = manager.runtimeCache.get("b").lastUsed;
        expect(lb).toBeGreaterThan(la);
    });

    it("keeps exactly one LRU entry per app across evict/re-setup cycles", async () => {
        const manager = createLazyManager(1);
        const a = createProxy();
        manager.appProxies = new Map([["a", a]]);
        manager.runtimeCache.set("a", { lastUsed: 0, state: "ready" });

        // setup completes (ready) -> evicted (slot dropped) -> re-setup
        await AppManager.prototype.enqueueAppSetup.call(manager, "a");
        expect(manager.runtimeCache.get("a")?.state).toBe("ready");
        expect(manager.runtimeCache.size).toBe(1);

        manager.runtimeCache.delete("a"); // eviction drop
        await AppManager.prototype.enqueueAppSetup.call(manager, "a");
        const entries = Array.from(manager.runtimeCache.keys()).filter((k) => k === "a");
        expect(entries).toHaveLength(1);
        expect(manager.runtimeCache.get("a")?.state).toBe("ready");
    });

    it("cancels queued lazy teardowns on lazy->eager transition and keeps in-flight dedupe", async () => {
        const manager = createLazyManager(2);
        const a = createProxy({ isSetup: true });
        manager.appProxies = new Map([["a", a]]);
        manager.runtimeCache.set("a", { lastUsed: 1, state: "ready" });
        manager.settingUpApps.set("in-flight", Promise.resolve());

        // occupy the serial queue, queue a lazy teardown behind it
        const release: Array<() => void> = [];
        const blocker = manager.setupTaskQueue.push(
            "blocker",
            () => -1,
            () => new Promise<void>((r) => release.push(r)),
        );
        const teardownPromise = AppManager.prototype.teardownRuntime.call(manager, "a");

        // transition lazy -> eager while the teardown is still queued
        manager.windowManger.lazySetupInMaximizedMode = false;
        manager.clearLazyBookkeeping();

        release[0]();
        await blocker;
        await teardownPromise;

        // queued teardown became a no-op (runtime kept alive, no teardown)
        expect(a.teardown).not.toHaveBeenCalled();
        // in-flight/queued setup dedupe is preserved across the transition
        expect(manager.settingUpApps.has("in-flight")).toBe(true);
        expect(manager.runtimeCache.size).toBe(0);
    });

    it("enqueueAppSetup returns the same Promise and sets up once (real dedupe)", async () => {
        const manager = createLazyManager(3);
        const a = createProxy();
        manager.appProxies = new Map([["a", a]]);

        // block the serial queue so both calls are pending before running
        const release: Array<() => void> = [];
        const blocker = manager.setupTaskQueue.push(
            "blocker",
            () => -1,
            () => new Promise<void>((r) => release.push(r)),
        );

        const p1 = AppManager.prototype.enqueueAppSetup.call(manager, "a");
        const p2 = AppManager.prototype.enqueueAppSetup.call(manager, "a");

        expect(p1).toBe(p2); // identical Promise object, not just equal
        expect(manager.settingUpApps.get("a")).toBe(p1);

        release[0]();
        await blocker;
        await Promise.all([p1, p2]);

        expect(a.ensureSetup).toHaveBeenCalledTimes(1);
        expect(manager.settingUpApps.size).toBe(0);
    });

    it("queued minimized batch teardown becomes a no-op after lazy->eager transition", async () => {
        const manager = createLazyManager(2);
        const ok = createProxy({ isSetup: true });
        manager.appProxies = new Map([["ok", ok]]);
        manager.runtimeCache.set("ok", { lastUsed: 1, state: "ready" });

        // queue the batch teardown behind a blocker
        const release: Array<() => void> = [];
        const blocker = manager.setupTaskQueue.push(
            "blocker",
            () => -1,
            () => new Promise<void>((r) => release.push(r)),
        );
        const batchPromise = AppManager.prototype.teardownAllRuntimeCaches.call(manager);

        // transition lazy -> eager while queued (real flow: guard + clear)
        manager.windowManger.lazySetupInMaximizedMode = false;
        manager.clearLazyBookkeeping();

        release[0]();
        await blocker;
        await batchPromise;

        // batch became a no-op: runtime kept alive, no teardown call
        expect(ok.teardown).not.toHaveBeenCalled();
    });

    it("ranks forceTop above the focused app in setup priority", () => {
        const manager = createLazyManager(1);
        manager.windowManger.attributes = {
            apps: {
                top: { forceTop: true },
                focused: {},
                plain: {},
            },
            minimized: false,
        };
        manager.store = { focus: "focused" };
        const priorityOf = (id: string) =>
            (AppManager.prototype as any).computeSetupPriority.call(manager, id);
        expect(priorityOf("top")).toBeLessThan(priorityOf("focused"));
        expect(priorityOf("focused")).toBeLessThan(priorityOf("plain"));
    });

    it("pins the cache slot when teardown throws instead of forgetting the runtime", async () => {
        const manager = createLazyManager(2);
        const flaky = createProxy({ isSetup: true });
        flaky.teardown = vi.fn().mockRejectedValue(new Error("half torn down"));
        manager.appProxies = new Map([["flaky", flaky]]);
        manager.runtimeCache.set("flaky", { lastUsed: 1, state: "ready" });

        await AppManager.prototype.teardownRuntime.call(manager, "flaky");

        // runtime may still be alive: keep the bookkeeping, exclude from eviction
        const entry = manager.runtimeCache.get("flaky");
        expect(entry?.state).toBe("pinned");
        expect(flaky.teardown).toHaveBeenCalledTimes(1);
        const st = { cache: Array.from(manager.runtimeCache.values()) };
        expect(st.cache.filter((c) => c.state === "ready")).toHaveLength(0);
        // a later eviction round must not target the pinned slot
        await AppManager.prototype.evictBeforeSetup.call(manager, "incoming");
        expect(flaky.teardown).toHaveBeenCalledTimes(1);
    });

    it("pins slots on minimized batch teardown when teardown rejects", async () => {
        const manager = createLazyManager(2);
        const ok = createProxy({ isSetup: true });
        const flaky = createProxy({ isSetup: true });
        flaky.teardown = vi.fn().mockRejectedValue(new Error("half torn down"));
        const another = createProxy({ isSetup: true });
        manager.appProxies = new Map([
            ["ok", ok],
            ["flaky", flaky],
            ["another", another],
        ]);
        manager.runtimeCache.set("ok", { lastUsed: 1, state: "ready" });
        manager.runtimeCache.set("flaky", { lastUsed: 2, state: "ready" });

        await AppManager.prototype.teardownAllRuntimeCaches.call(manager);

        // healthy slot removed; failed slot pinned and still counted
        expect(manager.runtimeCache.has("ok")).toBe(false);
        expect(manager.runtimeCache.get("flaky")?.state).toBe("pinned");
        expect(flaky.teardown).toHaveBeenCalledTimes(1);

        // a later eviction round must not touch the pinned slot again
        manager.runtimeCache.set("another", { lastUsed: 3, state: "ready" });
        await AppManager.prototype.evictBeforeSetup.call(manager, "incoming");
        expect(another.teardown).toHaveBeenCalledTimes(1);
        expect(flaky.teardown).toHaveBeenCalledTimes(1);
        expect(manager.runtimeCache.has("another")).toBe(false);
        expect(manager.runtimeCache.get("flaky")?.state).toBe("pinned");
    });

    it("soft-overflows when only no-teardown runtimes occupy a full cache", async () => {
        const manager = createLazyManager(1);
        const zombie = createProxy({ isSetup: true });
        zombie.canTeardown = false;
        const fresh = createProxy();
        manager.appProxies = new Map([
            ["zombie", zombie],
            ["fresh", fresh],
        ]);
        manager.runtimeCache.set("zombie", { lastUsed: 1, state: "ready" });

        // cache is full (1) with an unsuspendable runtime: evicting is
        // impossible, the new app is still set up (soft overflow, counted)
        await AppManager.prototype.evictBeforeSetup.call(manager, "fresh");

        await AppManager.prototype.enqueueAppSetup.call(manager, "fresh");

        expect(fresh.ensureSetup).toHaveBeenCalledTimes(1);
        expect(zombie.teardown).not.toHaveBeenCalled();
        expect(manager.runtimeCache.size).toBe(2); // soft overflow, counted
    });

    it("trims the cache after focus commit and releases the old runtime last", async () => {
        const manager = createLazyManager(1);
        const previous = createProxy({ isSetup: true });
        const next = createProxy({ isSetup: true });
        manager.appProxies = new Map([
            ["previous", previous],
            ["next", next],
        ]);
        manager.runtimeCache.set("previous", { lastUsed: 1, state: "ready" });
        manager.runtimeCache.set("next", { lastUsed: 2, state: "ready" });
        manager.activeLazyAppId = "next";

        await AppManager.prototype.evictAfterFocusCommit.call(manager, "next");

        expect(previous.teardown).toHaveBeenCalledTimes(1);
        expect(next.teardown).not.toHaveBeenCalled();
        expect(manager.runtimeCache.has("previous")).toBe(false);
        expect(manager.runtimeCache.get("next")?.state).toBe("ready");
    });
});
