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

    it("waitForSetup returns the result and rethrows the original setup error", async () => {
        const { proxy } = createProxy();
        const result = { controller: true };
        proxy.setupCompletionPromise = Promise.resolve({ succeeded: true, result });
        await expect(proxy.waitForSetup()).resolves.toBe(result);

        const error = new Error("setup failed");
        proxy.setupCompletionPromise = Promise.resolve({ succeeded: false, error });
        await expect(proxy.waitForSetup()).rejects.toBe(error);
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

        // Teardown while the setup promise is still in flight.
        await proxy.teardown();
        expect(app.teardown).toHaveBeenCalledOnce();

        resolveSetup({});
        await finishing;

        // The released runtime must not be marked ready, and waiters
        // (the serial setup queue) must observe the abort.
        expect(proxy.setupSucceeded).toBe(false);
        expect(proxy.setupStarted).toBe(false);
        await expect(proxy.waitForSetup()).rejects.toThrow("aborted by teardown");
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining("aborted by teardown/destroy")
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
