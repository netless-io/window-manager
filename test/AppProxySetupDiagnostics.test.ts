import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/index", () => ({
    WindowManager: class WindowManager {
        public static extendClass = undefined;
    },
}));
vi.mock("../src/Utils/extendClass", () => ({
    getExtendClass: (baseClass: unknown) => baseClass,
}));

let AppProxyClass: typeof import("../src/App/AppProxy")["AppProxy"];

beforeAll(async () => {
    (globalThis as any).CanvasRenderingContext2D = class CanvasRenderingContext2D {};
    AppProxyClass = (await import("../src/App/AppProxy")).AppProxy;
});

const createProxy = () => {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    const proxy = Object.create(AppProxyClass.prototype) as any;
    const appProxies = new Map();
    const viewManager = { destroyView: vi.fn(), createView: vi.fn(() => ({})) };
    Object.assign(proxy, {
        id: "app-1",
        kind: "Slide",
        status: "normal",
        manager: {
            windowManger: { Logger: logger },
            notifyAppDestroyed: vi.fn(),
            trackAppClose: vi.fn(),
            captureAppClose: vi.fn(() => ({ wasFocused: false, wasPending: false, generation: 0 })),
            getCloseSuccessor: vi.fn(),
            finishAppClose: vi.fn(),
            appProxies,
            viewManager,
            appStatus: new Map(),
            refresher: { add: vi.fn(), remove: vi.fn() },
        },
        appProxies,
        viewManager,
        appEmitter: {
            emit: vi.fn().mockResolvedValue(undefined),
            clearListeners: vi.fn(),
            onAny: vi.fn(),
            offAny: vi.fn(),
        },
        appAttributesUpdateListener: vi.fn(),
        boxSizeSynchronizer: { destroy: vi.fn() },
        _pageState: { destroy: vi.fn() },
        setupCompletionSettled: false,
        setupSucceeded: false,
        resolveSetupCompletion: vi.fn(),
    });
    proxy.manager.appProxies.set(proxy.id, proxy);
    return { proxy, logger };
};

describe("AppProxy setup diagnostics", () => {
    it("reports only committed local focus to a lazy App context", () => {
        const { proxy } = createProxy();
        proxy.manager.lazySetupEnabled = true;
        proxy.manager.isLazyFocusCommitted = vi.fn(() => false);
        proxy.manager.isLazyResourceFocused = vi.fn(() => true);
        proxy.store = { focus: "app-1" };

        expect(proxy.isFocused).toBe(false);
        expect(proxy.isResourceFocused).toBe(true);
        proxy.manager.isLazyFocusCommitted.mockReturnValue(true);
        expect(proxy.isFocused).toBe(true);
    });

    it("routes a legacy app focus request through lazy pending", () => {
        const { proxy } = createProxy();
        proxy.manager.canOperate = true;
        proxy.manager.lazySetupEnabled = true;
        proxy.manager.requestFocus = vi.fn();
        proxy.boxManager = { focusBox: vi.fn() };
        const listener = proxy.makeAppEventListener("app-1");

        listener("focus", undefined);
        listener("focus", true);

        expect(proxy.manager.requestFocus).toHaveBeenCalledOnce();
        expect(proxy.manager.requestFocus).toHaveBeenCalledWith("app-1");
        expect(proxy.boxManager.focusBox).not.toHaveBeenCalled();
    });

    it("defers an old app's zIndex feedback until it is selected again", () => {
        const { proxy } = createProxy();
        proxy.setupSucceeded = true;
        proxy.manager.lazySetupEnabled = true;
        proxy.manager.shouldDeferLazyZIndex = vi.fn(() => true);
        proxy.boxManager = {
            getBox: vi.fn(() => ({ zIndex: 315 })),
            setZIndex: vi.fn(),
            focusBox: vi.fn(),
        };

        proxy.syncBoxZIndex("app-1", 317);
        expect(proxy.boxManager.setZIndex).not.toHaveBeenCalled();
        expect(proxy.pendingZIndex).toBe(317);

        proxy.manager.shouldDeferLazyZIndex.mockReturnValue(false);
        proxy.flushPendingZIndex();
        expect(proxy.boxManager.setZIndex).toHaveBeenCalledWith("app-1", 317);
        expect(proxy.boxManager.focusBox).not.toHaveBeenCalled();
    });

    it("discards a deferred zIndex when the attribute returns to the current value", () => {
        const { proxy } = createProxy();
        proxy.setupSucceeded = true;
        proxy.manager.lazySetupEnabled = true;
        proxy.manager.shouldDeferLazyZIndex = vi.fn(() => true);
        proxy.boxManager = {
            getBox: vi.fn(() => ({ zIndex: 315 })),
            setZIndex: vi.fn(),
        };

        proxy.syncBoxZIndex("app-1", 317);
        proxy.syncBoxZIndex("app-1", 315);
        proxy.flushPendingZIndex();

        expect(proxy.boxManager.setZIndex).not.toHaveBeenCalled();
    });

    it("caps a pending target's attribute feedback at its reserved zIndex", () => {
        const { proxy } = createProxy();
        proxy.setupSucceeded = true;
        proxy.manager.lazySetupEnabled = true;
        proxy.manager.shouldDeferLazyZIndex = vi.fn(() => true);
        proxy.boxManager = {
            getBox: vi.fn(() => ({ zIndex: 300 })),
            setZIndex: vi.fn(),
        };

        proxy.syncBoxZIndex("app-1", 318);
        proxy.flushPendingZIndex(316);

        expect(proxy.boxManager.setZIndex).toHaveBeenCalledWith("app-1", 316);
    });

    it("sends true after false timed out, even when false later completes", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        await proxy.emitAppFocusEvent(true);
        let finishBlur!: () => void;
        proxy.appEmitter.emit = vi.fn()
            .mockImplementationOnce(() => new Promise<void>(resolve => { finishBlur = resolve; }))
            .mockResolvedValueOnce(undefined);
        const blur = proxy.emitAppFocusEvent(false);
        vi.advanceTimersByTime(10_000);
        await expect(blur).resolves.toBe(false);
        await expect(proxy.emitAppFocusEvent(true)).resolves.toBe(true);
        finishBlur(); await Promise.resolve();
        expect(proxy.appEmitter.emit.mock.calls.map((call: any[]) => call[1])).toEqual([false, true]);
        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("a rejected transition makes the previous boolean retryable too", async () => {
        const { proxy, logger } = createProxy();
        await proxy.emitAppFocusEvent(true);
        proxy.appEmitter.emit = vi.fn().mockRejectedValueOnce(new Error("partial freeze"))
            .mockResolvedValueOnce(undefined);
        await expect(proxy.emitAppFocusEvent(false)).resolves.toBe(false);
        await expect(proxy.emitAppFocusEvent(true)).resolves.toBe(true);
        expect(proxy.appEmitter.emit).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("focus event rejected"));
    });

    it("late old rejection cannot invalidate a newer successful notification", async () => {
        const { proxy } = createProxy();
        let failOld!: (reason: Error) => void;
        proxy.appEmitter.emit = vi.fn()
            .mockImplementationOnce(() => new Promise<void>((_, reject) => { failOld = reject; }))
            .mockResolvedValueOnce(undefined);
        const old = proxy.emitAppFocusEvent(false);
        const current = proxy.emitAppFocusEvent(true);
        await expect(current).resolves.toBe(true);
        failOld(new Error("late failure")); await old;
        expect(proxy.emitAppFocusEvent(true)).toBe(current);
        expect(proxy.appEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it("activity changes invalidate a same-focus completion", async () => {
        const { proxy } = createProxy();
        await proxy.emitAppFocusEvent(true);
        proxy.manager.activityRevision = 1;
        await proxy.emitAppFocusEvent(true);
        expect(proxy.appEmitter.emit).toHaveBeenCalledTimes(2);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("clears the watchdog after setup succeeds", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        const result = {};

        const setupResult = await proxy.runAppSetup(
            "app-1",
            { setup: vi.fn().mockResolvedValue(result) },
            {}
        );
        vi.advanceTimersByTime(10_000);

        expect(setupResult).toEqual({ succeeded: true, result });
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("unblocks a focus transition when an app focus listener never settles", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        proxy.appEmitter.emit = vi.fn(() => new Promise(() => undefined));

        const notification = proxy.emitAppFocusEvent(true);
        vi.advanceTimersByTime(10_000);
        await expect(notification).resolves.toBe(false);

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining("focus event timeout")
        );
    });

    it("waits for the app focus listener and reuses its promise for duplicate focus", async () => {
        const { proxy } = createProxy();
        let release!: () => void;
        proxy.appEmitter.emit = vi.fn(
            () => new Promise<void>(resolve => (release = resolve))
        );

        const first = proxy.emitAppFocusEvent(true);
        const duplicate = proxy.emitAppFocusEvent(true);
        expect(duplicate).toBe(first);
        expect(proxy.appEmitter.emit).toHaveBeenCalledOnce();

        release();
        await expect(first).resolves.toBe(true);
    });

    it("reports listener failure and allows the same focus state to retry", async () => {
        const { proxy, logger } = createProxy();
        proxy.appEmitter.emit = vi
            .fn()
            .mockRejectedValueOnce(new Error("unfreeze failed"))
            .mockResolvedValueOnce(undefined);

        await expect(proxy.emitAppFocusEvent(true)).resolves.toBe(false);
        await expect(proxy.emitAppFocusEvent(true)).resolves.toBe(true);

        expect(proxy.appEmitter.emit).toHaveBeenCalledTimes(2);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("stage: focus event")
        );
    });

    it("waitForSetup returns the result and rethrows the original setup error", async () => {
        const { proxy } = createProxy();
        const result = { controller: true };
        proxy.setupCompletionPromise = Promise.resolve({ succeeded: true, result });
        await expect(proxy.waitForSetup()).resolves.toBe(result);

        const error = new Error("setup failed");
        proxy.setupCompletionPromise = Promise.resolve({ succeeded: false, error });
        await expect(proxy.waitForSetup()).rejects.toBe(error);
    });

    it("keeps a waiter registered before the first deferred setup starts", async () => {
        const { proxy } = createProxy();
        const result = { controller: true };
        proxy.resetSetupCompletion();
        proxy.deferredSetup = { app: {}, context: {} };
        proxy.attachSetupScope = vi.fn();
        proxy.setViewFocusScenePath = vi.fn();
        proxy.finishAppSetup = vi.fn(async () => {
            proxy.settleSetup({ succeeded: true, result });
        });
        const waiting = proxy.waitForSetup();

        await expect(proxy.ensureSetup()).resolves.toBe(result);
        await expect(waiting).resolves.toBe(result);
    });

    it("does not let an old setup attempt settle a newer retry", async () => {
        const { proxy } = createProxy();
        proxy.resetSetupCompletion();
        const oldWait = proxy.waitForSetup();
        const settleOld = proxy.createSetupSettler();
        proxy.resetSetupCompletion();
        const newWait = proxy.waitForSetup();
        const settleNew = proxy.createSetupSettler();
        const oldError = new Error("old setup aborted");

        settleOld({ succeeded: false, error: oldError });
        await expect(oldWait).rejects.toBe(oldError);
        expect(proxy.setupCompletionSettled).toBe(false);
        settleNew({ succeeded: true, result: "new runtime" });
        await expect(newWait).resolves.toBe("new runtime");
    });

    it("settles an attempt invalidated while its focus notification is in flight", async () => {
        const { proxy } = createProxy();
        let finishFocus!: () => void;
        proxy.store = { focus: "app-1" };
        proxy.setupRunGeneration = 0;
        proxy.runAppSetup = vi.fn().mockResolvedValue({ succeeded: true, result: {} });
        proxy.emitAppFocusEvent = vi.fn(() => new Promise<void>(resolve => {
            finishFocus = resolve;
        }));
        const settle = vi.fn();

        const setup = proxy.finishAppSetup("app-1", {} as any, {} as any, undefined, undefined, settle);
        for (let i = 0; i < 5 && !finishFocus; i += 1) await Promise.resolve();
        expect(finishFocus).toBeTypeOf("function");
        proxy.setupRunGeneration += 1;
        finishFocus();
        await setup;
        expect(settle).toHaveBeenCalledOnce();
        expect(settle.mock.calls[0][0]).toMatchObject({ succeeded: false });
    });

    it("ensureSetup rejects a failed setup instead of returning an empty result", async () => {
        const { proxy } = createProxy();
        const error = new Error("setup failed");
        proxy.setupStarted = true;
        proxy.setupCompletionPromise = Promise.resolve({ succeeded: false, error });

        await expect(proxy.ensureSetup()).rejects.toBe(error);
    });

    it("does not mark the app as set up when teardown runs during setup", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        let resolveSetup!: (result: unknown) => void;
        const app = {
            setup: vi.fn().mockImplementation(
                () => new Promise<void>(resolve => (resolveSetup = resolve))
            ),
            teardown: vi.fn().mockResolvedValue(undefined),
        };
        proxy.appDefinition = app;
        proxy.appContext = {};
        proxy.setupStarted = true;
        proxy.setupSucceeded = false;
        proxy.setupCompletionSettled = false;
        proxy.setupCompletionPromise = new Promise(
            resolve => (proxy.resolveSetupCompletion = resolve)
        );

        const finishing = proxy.finishAppSetup("app-1", app, {}, undefined, undefined);
        await Promise.resolve();
        await Promise.resolve();

        // Teardown invalidates the attempt, but waits for a real setupResult.
        const tearingDown = proxy.teardown();
        await Promise.resolve();
        expect(app.teardown).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10_000);
        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("app teardown timeout")
        );

        resolveSetup({});
        await tearingDown;
        await finishing;
        expect(app.teardown).toHaveBeenCalledOnce();
        expect(app.teardown).toHaveBeenCalledWith({}, {});

        // The released runtime must not be marked ready, and waiters
        // (the serial setup queue) must observe the abort.
        expect(proxy.setupSucceeded).toBe(false);
        expect(proxy.setupStarted).toBe(false);
        await expect(proxy.waitForSetup()).rejects.toThrow("aborted by teardown");
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining("aborted by teardown/destroy")
        );
    });

    it("reports a teardown still running at 10s exactly once", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        let finishTeardown!: () => void;
        const app = {
            teardown: vi.fn(() => new Promise<void>(resolve => {
                finishTeardown = resolve;
            })),
        };
        proxy.appDefinition = app;
        proxy.appContext = {};
        proxy.setupStarted = true;
        proxy.setupCompletionSettled = true;
        const cleanup = proxy.teardown();

        vi.advanceTimersByTime(9_999);
        expect(logger.error).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("app teardown timeout")
        );
        vi.advanceTimersByTime(10_000);
        expect(logger.error).toHaveBeenCalledOnce();
        finishTeardown();
        await cleanup;
    });

    it("propagates failed late teardown so its cache slot can be pinned", async () => {
        const { proxy, logger } = createProxy();
        let finishSetup!: (result: unknown) => void;
        const app = {
            setup: vi.fn(() => new Promise(resolve => {
                finishSetup = resolve;
            })),
            teardown: vi.fn().mockRejectedValue(new Error("release failed")),
        };
        proxy.appDefinition = app;
        proxy.appContext = {};
        proxy.setupStarted = true;
        proxy.setupSucceeded = false;
        proxy.setupCompletionSettled = false;
        proxy.resetSetupCompletion();
        const finishing = proxy.finishAppSetup("app-1", app, {});
        for (let i = 0; i < 5 && !finishSetup; i += 1) await Promise.resolve();

        const cleanup = proxy.teardown();
        finishSetup({});
        await expect(cleanup).rejects.toThrow("release failed");
        await finishing;
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("late app teardown failed")
        );
    });

    it("marks setup success normally when no teardown interferes", async () => {
        vi.useFakeTimers();
        const { proxy } = createProxy();
        const result = { ok: true };
        const app = { setup: vi.fn().mockResolvedValue(result) };
        proxy.appDefinition = app;
        proxy.appContext = {};
        proxy.setupStarted = true;
        proxy.scheduleBoxSizeSync = vi.fn();
        proxy.afterSetupApp = vi.fn();
        proxy.flushPendingZIndex = vi.fn();
        proxy.fixMobileSize = vi.fn();

        await proxy.finishAppSetup("app-1", app, {}, undefined, undefined);
        vi.advanceTimersByTime(10_000);

        expect(proxy.setupSucceeded).toBe(true);
    });

    it("keeps a selected target active without emitting focus before room commit", async () => {
        const { proxy } = createProxy();
        proxy.store = { focus: "previous" };
        proxy.manager.lazySetupEnabled = true;
        proxy.manager.isPreparingLazyFocus = vi.fn(() => true);
        proxy.scheduleBoxSizeSync = vi.fn();
        proxy.fixMobileSize = vi.fn();
        proxy.emitAppFocusEvent = vi.fn().mockResolvedValue(true);
        proxy.emitAppActivityEvent = vi.fn().mockResolvedValue(true);
        const settle = vi.fn();

        await proxy.finishAppSetup(
            "app-1",
            { setup: vi.fn().mockResolvedValue({}) },
            {} as any,
            undefined,
            undefined,
            settle
        );

        expect(proxy.emitAppFocusEvent).not.toHaveBeenCalled();
        expect(proxy.emitAppActivityEvent).toHaveBeenCalledOnce();
        expect(proxy.store.focus).toBe("previous");
        expect(settle).toHaveBeenCalledWith({ succeeded: true, result: {} });
    });

    it("ensureSetup rejects when app setup never produced a descriptor", async () => {
        const { proxy } = createProxy();

        await expect(proxy.ensureSetup()).rejects.toThrow(
            "app setup descriptor is unavailable"
        );
    });

    it("waits for async app initialization before checking the setup descriptor", async () => {
        const { proxy } = createProxy();
        let resolveInitialization!: () => void;
        proxy.setupInitializationPromise = new Promise(resolve => {
            resolveInitialization = resolve;
        });
        proxy.setupDescriptor = { app: {}, context: {} };
        proxy.attachSetupScope = vi.fn();
        proxy.setViewFocusScenePath = vi.fn();
        proxy.resetSetupCompletion = vi.fn();
        proxy.finishAppSetup = vi.fn().mockResolvedValue(undefined);
        proxy.setupCompletionPromise = Promise.resolve({ succeeded: true, result: "ready" });

        const setup = proxy.ensureSetup();
        await Promise.resolve();
        expect(proxy.finishAppSetup).not.toHaveBeenCalled();

        resolveInitialization();
        await expect(setup).resolves.toBe("ready");
        expect(proxy.finishAppSetup).toHaveBeenCalledOnce();
    });

    it("reports setup only after setup completion succeeds", () => {
        const { proxy } = createProxy();

        proxy.setupStarted = true;
        expect(proxy.isSetup).toBe(false);
        proxy.setupSucceeded = true;
        expect(proxy.isSetup).toBe(true);
    });

    it("reattaches the setup scope after teardown before a lazy re-setup", () => {
        const { proxy } = createProxy();
        proxy.appListener = vi.fn();

        proxy.attachSetupScope("app-1");
        proxy.detachSetupScope();
        proxy.attachSetupScope("app-1");

        expect(proxy.appEmitter.onAny).toHaveBeenCalledTimes(2);
        expect(proxy.appEmitter.offAny).toHaveBeenCalledTimes(1);
        expect(proxy.appAttributesUpdateListener).toHaveBeenCalledTimes(2);
    });

    it("creates the View synchronously for the initial page state", () => {
        const { proxy } = createProxy();
        proxy.setViewFocusScenePath = vi.fn();

        const view = proxy.viewManager.createView();
        proxy.viewManager.createView.mockReturnValue(view);

        expect(proxy.createView()).toBe(view);
        expect(proxy.viewManager.createView).toHaveBeenCalledWith(proxy.id);
    });

    it("logs one error and clears the watchdog when setup rejects", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();

        const setupResult = await proxy.runAppSetup(
            "app-1",
            { setup: vi.fn().mockRejectedValue(new Error("setup failed")) },
            {}
        );
        vi.advanceTimersByTime(10_000);

        expect(setupResult).toEqual({ succeeded: false, error: expect.any(Error) });
        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining(
                "[WindowManager]: app setup error, kind: Slide, appId: app-1, status: normal, error: setup failed, stack: Error: setup failed"
            )
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("includes destroyed status when setup rejects after destroy", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        let rejectSetup!: (reason: Error) => void;
        const setupPromise = new Promise<object>((_, reject) => {
            rejectSetup = reject;
        });
        const pendingSetup = proxy.runAppSetup(
            "app-1",
            { setup: vi.fn(() => setupPromise) },
            {}
        );

        await proxy.destroy(false, false, true);
        rejectSetup(new Error("setup stopped"));
        await pendingSetup;

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining(
                "[WindowManager]: app setup error, kind: Slide, appId: app-1, status: destroyed, error: setup stopped, stack: Error: setup stopped"
            )
        );
    });

    it("logs one hydrate timeout while setup remains pending", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        let resolveSetup!: (value: object) => void;
        const setupPromise = new Promise<object>(resolve => {
            resolveSetup = resolve;
        });

        const pendingSetup = proxy.runAppSetup(
            "app-1",
            { setup: vi.fn(() => setupPromise) },
            {}
        );
        vi.advanceTimersByTime(9_999);
        expect(logger.warn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        vi.advanceTimersByTime(30_000);
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(
            "[WindowManager]: hydrate timeout, stage: app setup, kind: Slide, appId: app-1, timeout: 10000ms"
        );

        resolveSetup({});
        await pendingSetup;
    });

    it("settles lazy setup at 10s and releases a late result without marking it ready", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        proxy.manager.lazySetupEnabled = true;
        let resolveSetup!: (result: object) => void;
        const setup = new Promise<object>(resolve => { resolveSetup = resolve; });
        const teardown = vi.fn().mockResolvedValue(undefined);
        const app = { setup: vi.fn(() => setup), teardown };
        const pending = proxy.runAppSetup("app-1", app, {});

        vi.advanceTimersByTime(9_999);
        expect(teardown).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(await pending).toMatchObject({ succeeded: false, error: expect.any(Error) });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("app setup timed out"));

        const result = {};
        resolveSetup(result);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(teardown).toHaveBeenCalledWith({}, result);
        expect(proxy.isSetup).toBe(false);
    });

    it("does not report a lazy setup timeout as an app failure after intentional destroy", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        proxy.manager.lazySetupEnabled = true;
        let resolveSetup!: (result: object) => void;
        const setup = new Promise<object>(resolve => { resolveSetup = resolve; });
        const pending = proxy.runAppSetup("app-1", { setup: () => setup }, {});

        await proxy.destroy(false, false, true);
        vi.advanceTimersByTime(10_000);
        expect(await pending).toMatchObject({ succeeded: false });
        expect(logger.error).not.toHaveBeenCalled();
        resolveSetup({});
        await Promise.resolve();
    });

    it("closes a retained Slide outside the cache through the real destroy lifecycle", async () => {
        const { proxy } = createProxy();
        proxy.setupSucceeded = true;
        proxy.setupRunGeneration = 0;
        proxy.store = { cleanAppAttributes: vi.fn() };
        proxy.boxManager = { closeBox: vi.fn() };
        proxy.manager.closeApp = vi.fn(() => proxy.destroy(true, true, false));
        let finishDestroy!: () => void;
        proxy.appEmitter.emit.mockImplementationOnce(
            () => new Promise<void>(resolve => { finishDestroy = resolve; })
        );

        const closing = proxy.close();
        // notifyApp is async; allow the app's destroy listener to start.
        for (let i = 0; i < 10 && !finishDestroy; i += 1) await Promise.resolve();
        expect(proxy.appEmitter.emit).toHaveBeenCalledWith("destroy", { error: undefined });
        expect(proxy.viewManager.destroyView).not.toHaveBeenCalled();
        finishDestroy();
        await closing;

        expect(proxy.manager.closeApp).toHaveBeenCalledWith("app-1");
        expect(proxy.manager.notifyAppDestroyed).toHaveBeenCalledWith("app-1");
        expect(proxy.viewManager.destroyView).toHaveBeenCalledWith("app-1");
        expect(proxy.boxManager.closeBox).toHaveBeenCalledWith("app-1", false);
        expect(proxy.appProxies.has("app-1")).toBe(false);
        expect(proxy.appEmitter.clearListeners).toHaveBeenCalled();
    });

    it("clears the watchdog when the app proxy is destroyed", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();
        let resolveSetup!: (value: object) => void;
        const setupPromise = new Promise<object>(resolve => {
            resolveSetup = resolve;
        });
        const pendingSetup = proxy.runAppSetup(
            "app-1",
            { setup: vi.fn(() => setupPromise) },
            {}
        );

        await proxy.destroy(false, false, true);
        vi.advanceTimersByTime(10_000);

        expect(logger.warn).not.toHaveBeenCalled();
        resolveSetup({});
        await pendingSetup;
    });
});
