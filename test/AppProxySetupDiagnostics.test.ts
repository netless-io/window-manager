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
    const viewManager = { destroyView: vi.fn() };
    Object.assign(proxy, {
        id: "app-1",
        kind: "Slide",
        status: "normal",
        manager: {
            windowManger: { Logger: logger },
            appProxies,
            viewManager,
            appStatus: new Map(),
            refresher: { remove: vi.fn() },
        },
        appProxies,
        viewManager,
        appEmitter: {
            emit: vi.fn().mockResolvedValue(undefined),
            clearListeners: vi.fn(),
        },
        boxSizeSynchronizer: { destroy: vi.fn() },
        _pageState: { destroy: vi.fn() },
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

    it("logs one error and clears the watchdog when setup rejects", async () => {
        vi.useFakeTimers();
        const { proxy, logger } = createProxy();

        const setupResult = await proxy.runAppSetup(
            "app-1",
            { setup: vi.fn().mockRejectedValue(new Error("setup failed")) },
            {}
        );
        vi.advanceTimersByTime(10_000);

        expect(setupResult).toEqual({ succeeded: false });
        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
            "[WindowManager]: app setup error, kind: Slide, appId: app-1, status: normal, error: setup failed"
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
            "[WindowManager]: app setup error, kind: Slide, appId: app-1, status: destroyed, error: setup stopped"
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
