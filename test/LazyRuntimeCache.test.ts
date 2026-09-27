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
    manager.lazyFocusGeneration = 0;
    manager.destroyed = false;
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
    const invalidValues = [0, -3, 2.5, Number.NaN, Infinity];
    it.each([
        [undefined, 4],
        [0, 4],
        [-3, 4],
        [2.5, 4],
        [Number.NaN, 4],
        [Infinity, 4],
        [1, 1],
        [4, 4],
        [5, 5],
    ])("normalizes %s to %s", (value, expected) => {
        const warnings: string[] = [];
        const result = normalizeMaxCachedAppsInMaximizedMode(
            value as number | undefined,
            true,
            message => warnings.push(message)
        );
        expect(result).toBe(expected);
        expect(warnings).toHaveLength(
            invalidValues.includes(value as number) ? 1 : 0
        );
        if (invalidValues.includes(value as number)) {
            expect(warnings[0]).toContain("falling back to 4");
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
        expect(result).toBe(4);
        expect(warnings).toHaveLength(0);
    });
});

describe("AppManager lazy runtime cache", () => {
    it("defers the old app's zIndex feedback while another app is preparing", () => {
        const manager = createLazyManager(3) as any;
        manager.desiredLazyFocus = { focused: "slide", generation: 1 };
        manager.preparingLazyFocusAppId = "slide";

        expect(manager.shouldDeferLazyZIndex("presentation")).toBe(true);
        expect(manager.shouldDeferLazyZIndex("slide")).toBe(true);
        manager.preparingLazyFocusAppId = undefined;
        expect(manager.shouldDeferLazyZIndex("presentation")).toBe(true);

        manager.desiredLazyFocus = undefined;
        expect(manager.shouldDeferLazyZIndex("presentation")).toBe(false);

        manager.desiredLazyFocus = { focused: "slide", generation: 1 };
        manager.activeLazyAppId = "slide";
        expect(manager.shouldDeferLazyZIndex("presentation")).toBe(true);
        expect(manager.shouldDeferLazyZIndex("slide")).toBe(false);
        manager.windowManger.lazySetupInMaximizedMode = false;
        expect(manager.shouldDeferLazyZIndex("presentation")).toBe(false);
    });

    it("uses room focus as the previous app after TeleBox has selected the target", () => {
        const manager = createLazyManager(3) as any;
        manager.store.focus = "presentation";
        manager.attributes.apps.slide = {};
        manager.appProxies = new Map([["slide", createProxy()]]);
        manager.boxManager = {
            getFocusBox: vi.fn(() => ({ id: "slide" })),
            blurAllBox: vi.fn(),
        };
        manager.scheduleLazyIntent = vi.fn();

        AppManager.prototype.handleBoxFocus.call(manager, {
            appId: "slide",
            source: "telebox",
        });

        expect(manager.scheduleLazyIntent).toHaveBeenCalledWith(
            expect.objectContaining({ previous: "presentation", focused: "slide" })
        );
        expect(manager.pendingLazyBlurredAppId).toBe("presentation");
    });

    it("prepares only the selected lazy target while leaving room focus on the old app", () => {
        const manager = createLazyManager(3) as any;
        manager.store.focus = "previous";
        manager.desiredLazyFocus = { focused: "next", generation: 1 };
        manager.settingUpApps.set("next", Promise.resolve());

        expect(manager.isPreparingLazyFocus("next")).toBe(false);
        manager.preparingLazyFocusAppId = "next";
        expect(manager.isPreparingLazyFocus("next")).toBe(true);
        expect(manager.store.focus).toBe("previous");
        expect(manager.isPreparingLazyFocus("previous")).toBe(false);

        manager.attributes.minimized = true;
        expect(manager.isPreparingLazyFocus("next")).toBe(false);
        manager.attributes.minimized = false;
        manager.desiredLazyFocus = { focused: "another", generation: 2 };
        expect(manager.isPreparingLazyFocus("next")).toBe(false);
        manager.desiredLazyFocus = { focused: "next", generation: 3 };
        manager.settingUpApps.delete("next");
        expect(manager.isPreparingLazyFocus("next")).toBe(true);
        manager.settingUpApps.set("next", Promise.resolve());
        manager.windowManger.lazySetupInMaximizedMode = false;
        expect(manager.isPreparingLazyFocus("next")).toBe(false);
    });

    it("deactivates a superseded prepared target without blurring the shared focus", () => {
        const manager = createLazyManager(3) as any;
        const prepared = { emitAppFocusEvent: vi.fn().mockResolvedValue(true) };
        manager.store.focus = "previous";
        manager.desiredLazyFocus = { focused: "prepared", generation: 1 };
        manager.appProxies = new Map([["prepared", prepared]]);
        manager.cancelQueuedSetup = vi.fn();
        manager.getLazyScheduler = vi.fn(() => ({ push: vi.fn().mockResolvedValue(undefined) }));

        manager.scheduleLazyIntent({ focused: "next", generation: 2 });

        expect(prepared.emitAppFocusEvent).toHaveBeenCalledWith(false);
        expect(manager.isPreparingLazyFocus("prepared")).toBe(false);
        expect(manager.store.focus).toBe("previous");
    });

    it("reselects a target whose physical setup is still running", () => {
        const manager = createLazyManager(3) as any;
        manager.store.focus = "previous";
        manager.desiredLazyFocus = { focused: "other", generation: 2 };
        manager.setupStartedAt = new Map([["target", Date.now()]]);
        manager.appProxies = new Map();
        manager.getLazyScheduler = vi.fn(() => ({ push: vi.fn().mockResolvedValue(undefined) }));

        manager.scheduleLazyIntent({ focused: "target", generation: 3 });

        expect(manager.isPreparingLazyFocus("target")).toBe(true);
        expect(manager.store.focus).toBe("previous");
    });

    it("marks the target active while its real setup task runs", async () => {
        const manager = createLazyManager(3) as any;
        manager.store.focus = "previous";
        manager.attributes.apps.target = {};
        manager.desiredLazyFocus = { focused: "target", generation: 1 };
        const target = createProxy();
        const observed: boolean[] = [];
        target.ensureSetup.mockImplementation(async () => {
            await Promise.resolve();
            observed.push(manager.isPreparingLazyFocus("target"));
        });
        manager.appProxies = new Map([["target", target]]);

        await manager.enqueueAppSetup("target");

        expect(observed).toEqual([true]);
        expect(manager.settingUpApps.has("target")).toBe(false);
        expect(manager.isPreparingLazyFocus("target")).toBe(true);
        manager.scheduleLazyIntent({ focused: "replacement", generation: 2 });
        expect(manager.isPreparingLazyFocus("target")).toBe(false);
        expect(manager.store.focus).toBe("previous");
    });

    it("serializes lazy blur and ignores a stale blur from the previous app", async () => {
        const manager = createLazyManager(3) as any;
        manager.lazyFocusQueue = Promise.resolve();
        manager.pendingLazyFocusAppId = "next-app";
        manager.attributes.focus = "previous-app";
        manager.windowManger.safeSetAttributes = vi.fn();

        AppManager.prototype.queueLazyBoxBlurred.call(manager, { appId: "previous-app" });
        await manager.lazyFocusQueue;

        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
    });

    it("records a manager focus target before a queued stale blur can run", async () => {
        const manager = createLazyManager(3) as any;
        manager.attributes.focus = "previous-app";
        manager.store.setAppFocus = vi.fn();
        manager.windowManger.safeSetAttributes = vi.fn();
        manager.lazyFocusQueue = Promise.resolve();
        manager.scheduleLazyIntent = vi.fn(intent => {
            manager.pendingLazyFocusAppId = intent.focused;
        });

        AppManager.prototype.requestFocus.call(manager, "next-app");
        expect(manager.pendingLazyFocusAppId).toBe("next-app");

        AppManager.prototype.queueLazyBoxBlurred.call(manager, {
            appId: "previous-app",
        });
        await manager.lazyFocusQueue;

        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
    });

    it("serializes a real lazy blur before clearing shared focus", async () => {
        const manager = createLazyManager(3) as any;
        manager.attributes.focus = "app-1";
        manager.windowManger.safeSetAttributes = vi.fn();

        let release!: () => void;
        const blocker = new Promise<void>(resolve => {
            release = resolve;
        });
        manager.lazyFocusQueue = blocker;

        AppManager.prototype.queueLazyBoxBlurred.call(manager, { appId: "app-1" });
        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();

        release();
        await manager.lazyFocusQueue;

        expect(manager.windowManger.safeSetAttributes).toHaveBeenCalledWith({
            focus: undefined,
        });
    });

    it("keeps non-lazy blur synchronous", () => {
        const manager = createLazyManager(3) as any;
        manager.windowManger.lazySetupInMaximizedMode = false;
        manager.attributes.focus = "app-1";
        manager.windowManger.safeSetAttributes = vi.fn();

        AppManager.prototype.handleBoxBlurred.call(manager, { appId: "app-1" });

        expect(manager.windowManger.safeSetAttributes).toHaveBeenCalledWith({
            focus: undefined,
        });
        expect(manager.lazyFocusQueue).toBeUndefined();
    });

    it("keeps manager.focusApp's target pending without changing room focus", () => {
        const manager = createLazyManager(3) as any;
        manager.store.setAppFocus = vi.fn();

        AppManager.prototype.requestFocus.call(manager, "next-app");

        expect(manager.pendingLazyFocusAppId).toBe("next-app");
        expect(manager.store.setAppFocus).not.toHaveBeenCalled();
        expect(manager.desiredLazyFocus).toMatchObject({ focused: "next-app" });
    });

    it("does not authorize fallback for a steady-state focusApp request", () => {
        const manager = createLazyManager(3) as any;
        manager.windowManger.canOperate = true;
        manager._prevFocused = "app-a";
        manager.store = { focus: "app-a", setAppFocus: vi.fn() };
        manager.scheduleLazyIntent = vi.fn();

        AppManager.prototype.requestFocus.call(manager, "app-a");

        expect(manager.scheduleLazyIntent).toHaveBeenCalledWith({
            previous: "app-a",
            focused: "app-a",
            generation: 1,
            commitAfterSetup: true,
        });
        expect(manager.store.setAppFocus).not.toHaveBeenCalled();
    });

    it("requestFocusAndWait resolves true when the focus commits", async () => {
        const manager = createLazyManager(3) as any;
        manager._prevFocused = "previous";
        manager.store = {
            focus: "previous",
            setAppFocus: vi.fn(),
        };
        manager.appProxies = new Map();
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 0;
        manager.focusCommitWatchdogTimeout = 200;

        const wait = AppManager.prototype.requestFocusAndWait.call(
            manager,
            "next"
        );
        // 模拟 ensureLazyFocus 提交完成
        AppManager.prototype.settlePendingFocusCommit.call(manager, "next", true);
        expect(await wait).toBe(true);
        expect(manager.pendingFocusCommit).toBeUndefined();
    });

    it("a newer focus request replaces the pending one: old resolves false", async () => {
        const manager = createLazyManager(3) as any;
        manager._prevFocused = undefined;
        manager.store = { focus: undefined, setAppFocus: vi.fn() };
        manager.appProxies = new Map();
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 0;
        manager.focusCommitWatchdogTimeout = 5_000;

        const first = AppManager.prototype.requestFocusAndWait.call(manager, "app-a");
        const second = AppManager.prototype.requestFocusAndWait.call(manager, "app-b");

        expect(await first).toBe(false, "superseded request resolves false");
        AppManager.prototype.settlePendingFocusCommit.call(manager, "app-b", true);
        expect(await second).toBe(true);
        expect(manager.pendingFocusCommit).toBeUndefined();
    });

    it("remote authoritative focus immediately supersedes a pending focusApp request", () => {
        const manager = createLazyManager(3) as any;
        const resolve = vi.fn();
        manager._prevFocused = "remote-app";
        manager.pendingFocusCommit = {
            appId: "local-app",
            resolve,
            timer: setTimeout(() => undefined, 10_000),
        };

        AppManager.prototype.handleFocusChange.call(manager, "remote-app");

        expect(resolve).toHaveBeenCalledWith(false);
        expect(manager.pendingFocusCommit).toBeUndefined();
    });

    it("focus commit watchdog resolves false without dangling promises", async () => {
        const manager = createLazyManager(3) as any;
        manager._prevFocused = undefined;
        manager.store = { focus: undefined, setAppFocus: vi.fn() };
        manager.appProxies = new Map();
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 0;
        manager.focusCommitWatchdogTimeout = 50;

        const start = Date.now();
        const result = await AppManager.prototype.requestFocusAndWait.call(
            manager,
            "next"
        );
        expect(result).toBe(false);
        expect(Date.now() - start).toBeLessThan(3_000);
        expect(manager.pendingFocusCommit).toBeUndefined();
    });

    it("drops the superseded target's queued setup when a newer focus wins", async () => {
        const manager = createLazyManager(3) as any;
        const canceled: string[] = [];
        manager.setupTaskQueue = {
            cancel: (id: string) => {
                canceled.push(id);
                return true;
            },
        };
        manager._prevFocused = "newer";
        manager.store.focus = "newer";
        manager.appProxies = new Map();
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 7;
        manager.ensureLazyFocus = vi.fn();
        const previous = createProxy({ isSetup: true });
        previous.emitAppFocusEvent = vi.fn().mockResolvedValue(undefined);
        manager.appProxies.set("stale-target", previous);

        AppManager.prototype.queueLazyFocusTransition.call(
            manager,
            "stale-target",
            "stale-app",
            6
        );
        await manager.lazyFocusQueue;

        // Fix B：prev 的 blur 仍补发；被取代目标的排队 setup 被取消
        expect(previous.emitAppFocusEvent).toHaveBeenCalledWith(false);
        expect(canceled).toContain("setup:stale-app");
        expect(manager.ensureLazyFocus).not.toHaveBeenCalled();
    });

    it("cleans settingUpApps when canceling a queued setup", () => {
        const manager = createLazyManager(3) as any;
        manager.setupTaskQueue = { cancel: () => true };
        manager.settingUpApps = new Map([
            ["app-1", Promise.resolve()],
        ]);

        AppManager.prototype.cancelQueuedSetup.call(manager, "app-1");

        expect(manager.settingUpApps.has("app-1")).toBe(false);
    });

    it("keeps bookkeeping when the setup task already started", () => {
        const manager = createLazyManager(3) as any;
        manager.setupTaskQueue = { cancel: () => false };
        manager.settingUpApps = new Map([
            ["app-1", Promise.resolve()],
        ]);

        AppManager.prototype.cancelQueuedSetup.call(manager, "app-1");

        expect(manager.settingUpApps.has("app-1")).toBe(true);
    });

    it("still blurs the previous app when a newer focus request supersedes the transition", async () => {
        const manager = createLazyManager(3) as any;
        const previous = createProxy({ isSetup: true });
        previous.emitAppFocusEvent = vi.fn().mockResolvedValue(undefined);
        manager._prevFocused = "newer-app";
        manager.store.focus = "newer-app";
        manager.appProxies = new Map([
            ["previous", previous],
            ["newer-app", createProxy({ isSetup: true })],
        ]);
        manager.ensureLazyFocus = vi.fn().mockResolvedValue(undefined);
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 5;

        AppManager.prototype.queueLazyFocusTransition.call(
            manager,
            "previous",
            "stale-app",
            4
        );
        await manager.lazyFocusQueue;

        expect(previous.emitAppFocusEvent).toHaveBeenCalledWith(false);
        expect(manager.ensureLazyFocus).not.toHaveBeenCalled();
    });

    it("skips the blur when focus bounced back to the previous app", async () => {
        const manager = createLazyManager(3) as any;
        const previous = createProxy({ isSetup: true });
        previous.emitAppFocusEvent = vi.fn().mockResolvedValue(undefined);
        manager._prevFocused = "previous";
        manager.store.focus = "previous";
        manager.appProxies = new Map([["previous", previous]]);
        manager.ensureLazyFocus = vi.fn().mockResolvedValue(undefined);
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 5;

        AppManager.prototype.queueLazyFocusTransition.call(
            manager,
            "previous",
            "stale-app",
            4
        );
        await manager.lazyFocusQueue;

        expect(previous.emitAppFocusEvent).not.toHaveBeenCalled();
        expect(manager.ensureLazyFocus).not.toHaveBeenCalled();
    });

    it("clears the pending target after re-focusing the current lazy app", async () => {
        const manager = createLazyManager(3) as any;
        manager._prevFocused = "app-1";
        manager.store.focus = "app-1";
        manager.store.setAppFocus = vi.fn();
        manager.ensureLazyFocus = vi.fn().mockResolvedValue(undefined);
        manager.attributes.apps["app-1"] = {};
        manager.appProxies = new Map([["app-1", createProxy({ isSetup: true })]]);
        manager.evictBeforeSetup = vi.fn().mockResolvedValue(undefined);
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 0;

        AppManager.prototype.requestFocus.call(manager, "app-1");
        await manager.lazyFocusQueue;

        expect(manager.ensureLazyFocus).toHaveBeenCalledWith("app-1", 1);
        expect(manager.pendingLazyFocusAppId).toBeUndefined();
    });

    it("commits lazy focus only after the app focus emitter completes", async () => {
        const manager = createLazyManager(3) as any;
        let finishFocus!: (succeeded: boolean) => void;
        const focusNotification = new Promise<boolean>(resolve => {
            finishFocus = resolve;
        });
        const target = {
            ...createProxy({ isSetup: true }),
            kind: "Slide",
            emitAppFocusEvent: vi.fn(() => focusNotification),
        };
        manager.store.focus = "target";
        manager.preparingLazyFocusAppId = "target";
        manager.appProxies = new Map([["target", target]]);
        manager.runtimeCache.set("target", { state: "ready", lastUsed: 1 });
        manager.boxManager = {
            getBox: vi.fn(() => ({ id: "target" })),
            focusBox: vi.fn(),
            teleBoxManager: { makeBoxTop: vi.fn() },
        };
        manager.settlePendingFocusCommit = vi.fn();
        manager.evictAfterFocusCommit = vi.fn().mockResolvedValue(undefined);

        const commit = AppManager.prototype.ensureLazyFocus.call(manager, "target", 0);
        await Promise.resolve();

        expect(manager.settlePendingFocusCommit).not.toHaveBeenCalled();
        finishFocus(true);
        await expect(commit).resolves.toBe(true);
        expect(manager.settlePendingFocusCommit).toHaveBeenCalledWith("target", true, 0);
        expect(manager.preparingLazyFocusAppId).toBeUndefined();
    });

    it("does not commit lazy focus when the app focus emitter fails", async () => {
        const manager = createLazyManager(3) as any;
        const target = {
            ...createProxy({ isSetup: true }),
            kind: "Slide",
            emitAppFocusEvent: vi.fn().mockResolvedValue(false),
        };
        manager.store.focus = "target";
        manager.appProxies = new Map([["target", target]]);
        manager.runtimeCache.set("target", { state: "ready", lastUsed: 1 });
        manager.boxManager = {
            getBox: vi.fn(() => ({ id: "target" })),
            focusBox: vi.fn(),
            teleBoxManager: { makeBoxTop: vi.fn() },
        };
        manager.settlePendingFocusCommit = vi.fn();

        await expect(
            AppManager.prototype.ensureLazyFocus.call(manager, "target", 0)
        ).resolves.toBe(false);
        expect(manager.activeLazyAppId).toBeUndefined();
        expect(manager.settlePendingFocusCommit).not.toHaveBeenCalled();
    });

    it("runs the full lazy commit when the box focus already matches room focus", async () => {
        const manager = createLazyManager(1) as any;
        const target = createProxy();
        manager.attributes.apps.target = {};
        manager.store.focus = "target";
        manager.attributes.focus = "target";
        manager.appProxies = new Map([["target", target]]);
        manager.boxManager = {
            getFocusBox: vi.fn(() => ({ id: "target" })),
            blurAllBox: vi.fn(),
        };
        manager.evictBeforeSetup = vi.fn().mockResolvedValue(undefined);
        manager.enqueueAppSetup = vi.fn().mockResolvedValue(undefined);
        manager.ensureLazyFocus = vi.fn().mockResolvedValue(undefined);
        manager.lazyFocusQueue = Promise.resolve();

        AppManager.prototype.handleBoxFocus.call(manager, {
            appId: "target",
            source: "telebox",
        });
        await manager.lazyFocusQueue;

        expect(manager.evictBeforeSetup).toHaveBeenCalledWith("target");
        expect(manager.ensureLazyFocus).toHaveBeenCalledWith("target", 1);
    });

    it("absorbs TeleBox's old blurred -> new focused handoff without writing undefined", async () => {
        const manager = createLazyManager(1) as any;
        const target = createProxy();
        manager.attributes.apps.target = {};
        manager.windowManger.canOperate = true;
        manager.store.focus = "previous";
        manager.attributes.focus = "previous";
        manager.appProxies = new Map([["target", target]]);
        manager.windowManger.safeSetAttributes = vi.fn(({ focus }) => {
            manager.store.focus = focus;
            manager.attributes.focus = focus;
        });
        manager.boxManager = {
            maximized: true,
            getFocusBox: vi.fn(() => ({ id: "target" })),
            blurAllBox: vi.fn(() => {
                AppManager.prototype.handleBoxBlurred.call(manager, { appId: "target" });
            }),
            getTopBox: vi.fn(() => ({ id: "previous", zIndex: 9 })),
        };
        manager.evictBeforeSetup = vi.fn().mockResolvedValue(undefined);
        manager.enqueueAppSetup = vi.fn().mockResolvedValue(undefined);
        manager.requestFocus = vi.fn();
        manager.lazyFocusQueue = Promise.resolve();

        // This is TeleBox's observable order when the old box precedes the
        // target in its boxes array.
        AppManager.prototype.handleBoxBlurred.call(manager, { appId: "previous" });
        AppManager.prototype.handleBoxFocus.call(manager, {
            appId: "target",
            source: "telebox",
        });
        await manager.lazyFocusQueue;

        expect(manager.windowManger.safeSetAttributes).toHaveBeenCalledTimes(1);
        expect(manager.windowManger.safeSetAttributes).toHaveBeenCalledWith({
            focus: "target",
        });
        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalledWith({
            focus: undefined,
        });
        expect(manager.requestFocus).not.toHaveBeenCalled();
    });

    it("recovers highest-z only after a TeleBox lazy handoff ends undefined", async () => {
        const manager = createLazyManager(1) as any;
        const target = createProxy();
        manager.attributes.apps.target = {};
        manager.windowManger.canOperate = true;
        manager.windowManger.safeSetAttributes = vi.fn();
        manager.store.focus = undefined;
        manager.attributes.focus = undefined;
        manager.appProxies = new Map([["target", target]]);
        manager.boxManager = {
            maximized: true,
            getFocusBox: vi.fn(() => undefined),
            blurAllBox: vi.fn(),
            getTopBox: vi.fn(() => ({ id: "top-app", zIndex: 10 })),
        };
        manager.evictBeforeSetup = vi.fn().mockResolvedValue(undefined);
        manager.enqueueAppSetup = vi.fn().mockResolvedValue(undefined);
        manager.requestFocus = vi.fn();
        manager.lazyFocusQueue = Promise.resolve();

        AppManager.prototype.handleBoxFocus.call(manager, {
            appId: "target",
            source: "telebox",
        });
        await manager.lazyFocusQueue;

        expect(manager.boxManager.getTopBox).toHaveBeenCalledWith(undefined);
        expect(manager.requestFocus).toHaveBeenCalledWith("top-app");
    });

    it("does not recover top after a programmatic lazy focus ends undefined", async () => {
        const manager = createLazyManager(1) as any;
        const target = createProxy();
        manager.windowManger.canOperate = true;
        manager.windowManger.safeSetAttributes = vi.fn();
        manager.store.focus = undefined;
        manager.attributes.focus = undefined;
        manager.appProxies = new Map([["target", target]]);
        manager.boxManager = {
            maximized: true,
            getFocusBox: vi.fn(() => undefined),
            blurAllBox: vi.fn(),
            getTopBox: vi.fn(() => ({ id: "top-app", zIndex: 10 })),
        };
        manager.evictBeforeSetup = vi.fn().mockResolvedValue(undefined);
        manager.enqueueAppSetup = vi.fn().mockResolvedValue(undefined);
        manager.requestFocus = vi.fn();
        manager.lazyFocusQueue = Promise.resolve();

        AppManager.prototype.handleBoxFocus.call(manager, {
            appId: "target",
            source: "programmatic",
        });
        await manager.lazyFocusQueue;

        expect(manager.boxManager.getTopBox).not.toHaveBeenCalled();
        expect(manager.requestFocus).not.toHaveBeenCalled();
    });

    it("clears a failed current target so later blur is not blocked", async () => {
        const manager = createLazyManager(3) as any;
        manager._prevFocused = "app-1";
        manager.store.focus = "app-1";
        manager.store.setAppFocus = vi.fn();
        manager.ensureLazyFocus = vi.fn().mockRejectedValue(new Error("setup failed"));
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 0;

        AppManager.prototype.requestFocus.call(manager, "app-1");
        await manager.lazyFocusQueue;

        expect(manager.pendingLazyFocusAppId).toBeUndefined();
    });

    it("realigns the previous app only after a TeleBox setup failure handoff ends", async () => {
        const manager = createLazyManager(1) as any;
        manager.windowManger.canOperate = true;
        const previous = createProxy({ isSetup: true });
        const target = createProxy();
        manager.attributes.apps.target = {};
        previous.emitAppFocusEvent = vi.fn().mockResolvedValue(undefined);
        target.ensureSetup = vi.fn().mockRejectedValue(new Error("setup failed"));
        manager._prevFocused = "previous";
        manager.store.focus = "previous";
        manager.attributes.focus = "previous";
        manager.appProxies = new Map([
            ["previous", previous],
            ["target", target],
        ]);
        manager.windowManger.safeSetAttributes = vi.fn();
        manager.boxManager = {
            maximized: true,
            getFocusBox: vi.fn(() => ({ id: "target" })),
            blurAllBox: vi.fn(),
            focusBox: vi.fn(),
            getTopBox: vi.fn(() => ({ id: "previous", zIndex: 9 })),
        };
        manager.evictBeforeSetup = vi.fn().mockResolvedValue(undefined);
        manager.enqueueAppSetup = vi.fn().mockRejectedValue(new Error("setup failed"));
        manager.lazyFocusQueue = Promise.resolve();

        expect(manager.lazySetupEnabled).toBe(true);
        AppManager.prototype.handleBoxFocus.call(manager, {
            appId: "target",
            source: "telebox",
        });
        await manager.lazyFocusQueue;

        expect(manager.enqueueAppSetup).toHaveBeenCalledWith("target", expect.any(Function));
        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
        expect(manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "previous" });
    });

    it("defers TeleBox setup-failure recovery until the handoff finally block", () => {
        const manager = createLazyManager(1) as any;
        manager.windowManger.canOperate = true;
        const previous = createProxy({ isSetup: true });
        manager.store.focus = "previous";
        manager.attributes.focus = "previous";
        manager.appProxies = new Map([["previous", previous]]);
        manager.boxManager = { focusBox: vi.fn() };
        manager.windowManger.safeSetAttributes = vi.fn();

        AppManager.prototype.restoreFocusAfterLazySetupFailure.call(
            manager,
            "target",
            "previous",
            0,
            true
        );

        expect(manager.boxManager.focusBox).not.toHaveBeenCalled();
        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
    });

    it("readonly setup failure follows Attribute.focus instead of choosing a fallback", () => {
        const manager = createLazyManager(1) as any;
        const previous = createProxy({ isSetup: true });
        manager.windowManger.canOperate = false;
        manager.windowManger.safeSetAttributes = vi.fn();
        manager.store.focus = "failed";
        manager.attributes.focus = "failed";
        manager.appProxies = new Map([["previous", previous]]);
        manager.boxManager = {
            focusBox: vi.fn(),
            blurAllBox: vi.fn(),
            getTopBox: vi.fn(() => ({ id: "top-app" })),
        };

        AppManager.prototype.restoreFocusAfterLazySetupFailure.call(
            manager,
            "failed",
            "previous",
            0,
            false
        );

        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
        expect(manager.boxManager.getTopBox).not.toHaveBeenCalled();
        expect(manager.boxManager.focusBox).toHaveBeenCalledWith(
            { appId: "failed" }
        );
        expect(manager.boxManager.blurAllBox).not.toHaveBeenCalled();
    });

    it("writable synced-focus setup failure follows Attribute.focus without fallback", () => {
        const manager = createLazyManager(1) as any;
        const previous = createProxy({ isSetup: true });
        manager.windowManger.canOperate = true;
        manager.windowManger.safeSetAttributes = vi.fn();
        manager.store.focus = "synced-target";
        manager.attributes.focus = "synced-target";
        manager.appProxies = new Map([["previous", previous]]);
        manager.boxManager = {
            focusBox: vi.fn(),
            blurAllBox: vi.fn(),
            getTopBox: vi.fn(() => ({ id: "top-app" })),
        };

        AppManager.prototype.restoreFocusAfterLazySetupFailure.call(
            manager,
            "synced-target",
            "previous",
            0,
            false
        );

        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
        expect(manager.boxManager.getTopBox).not.toHaveBeenCalled();
        expect(manager.boxManager.focusBox).toHaveBeenCalledWith(
            { appId: "synced-target" }
        );
    });

    it("falls back to the highest-z app when there is no previous focus", () => {
        const manager = createLazyManager(1) as any;
        manager.store.focus = "failed";
        manager.attributes.focus = "failed";
        manager.attributes.maximized = true;
        manager._useBoxesStatus = false;
        manager.windowManger.canOperate = true;
        manager.windowManger.safeSetAttributes = vi.fn(({ focus }) => {
            manager.store.focus = focus;
        });
        manager.store.setAppFocus = vi.fn();
        const focusCommit = vi.fn();
        manager.pendingFocusCommit = {
            appId: "failed",
            resolve: focusCommit,
            timer: setTimeout(() => undefined, 5_000),
        };
        manager.boxManager = {
            maximized: true,
            getTopBox: vi.fn(() => ({ id: "top-app", zIndex: 10 })),
        };

        AppManager.prototype.restoreFocusAfterLazySetupFailure.call(
            manager,
            "failed",
            undefined,
            0,
            true
        );
        AppManager.prototype.restoreFocusAfterTeleBoxHandoff.call(manager, "failed");

        expect(manager.boxManager.getTopBox).toHaveBeenCalledWith("failed");
        expect(manager.windowManger.safeSetAttributes).not.toHaveBeenCalled();
        expect(manager.store.setAppFocus).not.toHaveBeenCalled();
        expect(manager.desiredLazyFocus).toMatchObject({ focused: "top-app" });
        expect(focusCommit).toHaveBeenCalledWith(false);
        expect(manager.pendingFocusCommit).toBeUndefined();
    });

    it("routes focusByAttributes through the lazy focus coordinator", () => {
        const manager = createLazyManager(3) as any;
        manager.attributes.minimized = false;
        manager.store.focus = "target";
        manager._prevFocused = undefined;
        manager.boxManager = { boxSize: 1 };
        manager.queueLazyFocusTransition = vi.fn();

        AppManager.prototype.focusByAttributes.call(manager, { target: {} });

        expect(manager.queueLazyFocusTransition).toHaveBeenCalledWith(
            undefined,
            "target",
            1
        );
    });

    it("routes reconnect focus through the lazy focus coordinator", async () => {
        const manager = createLazyManager(3) as any;
        const proxy = {
            id: "target",
            onReconnected: vi.fn().mockResolvedValue(undefined),
        };
        manager.attributes.apps = { target: {} };
        manager.store.focus = "target";
        manager._prevFocused = undefined;
        manager.appProxies = new Map([["target", proxy]]);
        manager.mainViewProxy = { onReconnect: vi.fn() };
        manager._attributesUpdateCallback = vi.fn().mockResolvedValue(undefined);
        manager.queueLazyFocusTransition = vi.fn();

        await AppManager.prototype.onReconnected.call(manager);

        expect(manager.queueLazyFocusTransition).toHaveBeenCalledWith(
            undefined,
            "target",
            1
        );
        expect(proxy.onReconnected).toHaveBeenCalledTimes(1);
    });

    it("waits for the previous app to suspend before setting up the next app", async () => {
        const manager = createLazyManager(3);
        const order: string[] = [];
        let finishSuspend!: () => void;
        const previous = createProxy({ isSetup: true });
        previous.emitAppFocusEvent = vi.fn(() => {
            order.push("suspend:start");
            return new Promise<void>(resolve => {
                finishSuspend = () => {
                    order.push("suspend:done");
                    resolve();
                };
            });
        });
        manager.appProxies = new Map([["previous", previous]]);
        manager.lazyFocusQueue = Promise.resolve();
        manager.lazyFocusGeneration = 1;
        manager.store.focus = "next";
        manager.ensureLazyFocus = vi.fn(async () => {
            order.push("setup:next");
        });

        AppManager.prototype.queueLazyFocusTransition.call(manager, "previous", "next", 1);
        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(["suspend:start"]);
        expect(manager.ensureLazyFocus).not.toHaveBeenCalled();

        finishSuspend();
        await manager.lazyFocusQueue;

        expect(order).toEqual(["suspend:start", "suspend:done", "setup:next"]);
        expect(manager.ensureLazyFocus).toHaveBeenCalledWith("next", 1);
    });

    it("does not recover top for an attributes-driven undefined focus", async () => {
        const manager = createLazyManager(3);
        let finishSuspend!: () => void;
        const previous = createProxy({ isSetup: true });
        previous.emitAppFocusEvent = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    finishSuspend = resolve;
                })
        );
        manager.appProxies = new Map([["previous", previous]]);
        manager.store.focus = undefined;
        manager.lazyFocusGeneration = 1;
        manager.lazyFocusQueue = Promise.resolve();
        manager.requestFocus = vi.fn();

        AppManager.prototype.queueLazyFocusTransition.call(manager, "previous", undefined, 1);
        await Promise.resolve();
        await Promise.resolve();
        expect(manager.requestFocus).not.toHaveBeenCalled();

        finishSuspend();
        await manager.lazyFocusQueue;

        expect(manager.requestFocus).not.toHaveBeenCalled();
    });

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

    it("re-registers an already set-up no-teardown runtime without setup", async () => {
        const manager = createLazyManager(1);
        const legacy = createProxy({ isSetup: true, canTeardown: false });
        manager.appProxies = new Map([["legacy", legacy]]);

        // Lazy bookkeeping can be absent after a mode transition, but the
        // runtime is still alive because it cannot be safely torn down.
        expect(manager.runtimeCache.has("legacy")).toBe(false);

        await AppManager.prototype.enqueueAppSetup.call(manager, "legacy");

        expect(legacy.ensureSetup).not.toHaveBeenCalled();
        expect(legacy.teardown).not.toHaveBeenCalled();
        expect(manager.runtimeCache.get("legacy")?.state).toBe("ready");
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
        manager.pendingLazyFocusAppId = "a";
        manager.pendingLazyBlurredAppId = "previous";
        manager.lazyFocusGeneration = 4;

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
        expect(manager.pendingLazyFocusAppId).toBeUndefined();
        expect(manager.pendingLazyBlurredAppId).toBeUndefined();
        expect(manager.lazyFocusGeneration).toBe(5);
    });

    it("invalidates a queued lazy focus after switching to eager mode", async () => {
        const manager = createLazyManager(1);
        manager.store.focus = "next";
        manager.lazyFocusGeneration = 1;
        manager.ensureLazyFocus = vi.fn().mockResolvedValue(undefined);
        let release!: () => void;
        const blocker = new Promise<void>(resolve => (release = resolve));
        manager.lazyFocusQueue = blocker;

        AppManager.prototype.queueLazyFocusTransition.call(manager, "previous", "next", 1);
        manager.windowManger.lazySetupInMaximizedMode = false;
        manager.clearLazyBookkeeping();
        release();
        await manager.lazyFocusQueue;

        expect(manager.ensureLazyFocus).not.toHaveBeenCalled();
    });

    it("does not swallow a queued blur after switching to eager mode", async () => {
        const manager = createLazyManager(1);
        manager.attributes.focus = "app-1";
        manager.pendingLazyBlurredAppId = "app-1";
        manager.windowManger.safeSetAttributes = vi.fn();
        let release!: () => void;
        const blocker = new Promise<void>(resolve => (release = resolve));
        manager.lazyFocusQueue = blocker;

        AppManager.prototype.queueLazyBoxBlurred.call(manager, { appId: "app-1" });
        manager.windowManger.lazySetupInMaximizedMode = false;
        manager.clearLazyBookkeeping();
        release();
        await manager.lazyFocusQueue;

        expect(manager.windowManger.safeSetAttributes).toHaveBeenCalledWith({
            focus: undefined,
        });
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

    it("clears lazy bookkeeping when force is removed or the room becomes normal", async () => {
        const { WindowManager } = await import("../src");
        const wm = Object.create(WindowManager.prototype) as any;
        const cleared: Array<Map<any, any> | undefined> = [];
        let setups = 0;
        Object.defineProperty(wm, "canOperate", { configurable: true, value: false });
        wm._forceMaximized = true;
        wm._lazySetupInMaximizedMode = true;
        wm.boxManager = { setForceMaximized: vi.fn() };
        wm._roomLogger = { warn: vi.fn() };
        wm.appManager = {
            runtimeCache: new Map([["stale", { lastUsed: 1, state: "ready" }]]),
            settingUpApps: new Map(),
            clearLazyBookkeeping() {
                cleared.push(this.runtimeCache);
                this.runtimeCache.clear();
                this.settingUpApps.clear();
                this.activeLazyAppId = undefined;
            },
            setupAllApps: vi.fn(async () => {
                setups += 1;
            }),
        };
        // A newer writable client's false request clears the shared policy.
        WindowManager.prototype.applyForceMaximized.call(wm, false);
        expect(wm._forceMaximized).toBe(false);
        expect(wm._lazySetupInMaximizedMode).toBe(false);
        expect(wm.boxManager.setForceMaximized).toHaveBeenCalledWith(false);
        expect(cleared).toHaveLength(1);
        expect(setups).toBe(1);

        wm._lazySetupInMaximizedMode = true;
        wm.appManager.runtimeCache.set("stale", { lastUsed: 2, state: "ready" });
        // A malformed room state still falls back to eager setup.
        wm.attributes = { minimized: false, maximized: false };
        WindowManager.prototype.applyForceMaximized.call(wm, true);
        expect(wm._lazySetupInMaximizedMode).toBe(false);
        expect(cleared.length).toBe(2);
        expect(wm.appManager.runtimeCache.size).toBe(0);
        expect(setups).toBe(2);
    });

    it("re-creates the cache entry when a torn-down app is re-set up", async () => {
        const manager = createLazyManager(2);
        const a = createProxy();
        manager.appProxies = new Map([["a", a]]);
        // simulate post-teardown state: no cache entry, app not yet setup
        manager.runtimeCache.clear();

        await AppManager.prototype.enqueueAppSetup.call(manager, "a");

        const entry = manager.runtimeCache.get("a");
        expect(entry?.state).toBe("ready");
        expect(manager.runtimeCache.size).toBe(1);
    });

    it("ignores forceTop setup priority when boxesStatus is disabled", () => {
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
        manager.useBoxesStatus = false;
        const priorityOf = (id: string) =>
            (AppManager.prototype as any).computeSetupPriority.call(manager, id);
        expect(priorityOf("focused")).toBeLessThan(priorityOf("top"));
        expect(priorityOf("top")).toBe(priorityOf("plain"));
    });

    it("ranks forceTop above the focused app when boxesStatus is enabled", () => {
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
        manager.useBoxesStatus = true;
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
        manager.attributes.minimized = true;
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

        // Refocusing the over-capacity legacy app is a cache hit. Even if the
        // setup scheduler is reached defensively, isSetup prevents re-setup.
        await AppManager.prototype.enqueueAppSetup.call(manager, "zombie");
        expect(zombie.ensureSetup).not.toHaveBeenCalled();
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
