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
        },
        attributes: { apps: {}, minimized: false },
    };
    manager.store = { focus: undefined };
    manager.setupTaskQueue = new SetupQueue();
    manager.runtimeCache = new Map();
    manager.settingUpApps = new Map();
    manager.activeLazyAppId = undefined;
    manager.warnings = warnings;
    return manager;
};

const createProxy = (overrides: Partial<{ isSetup: boolean }> = {}) => ({
    isDestroyed: false,
    isSetup: overrides.isSetup ?? false,
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
        manager.runtimeCache.set("app-1", { lastUsed: 1, state: "ready" });

        await AppManager.prototype.enqueueAppSetup.call(manager, "app-1");

        expect(proxy.ensureSetup).not.toHaveBeenCalled();
        expect(manager.runtimeCache.get("app-1")?.lastUsed).toBeGreaterThan(1);
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
