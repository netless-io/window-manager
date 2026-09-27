import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk");

import { AppManager } from "../src/AppManager";
import { AppProxy } from "../src/App/AppProxy";
import { WindowManager } from "../src";

const apps = {
    oldest: { kind: "Oldest", createdAt: 1 },
    focused: { kind: "Focused", createdAt: 2 },
    newest: { kind: "Newest", createdAt: 3 },
};

type ManagerOptions = {
    useBoxesStatus?: boolean;
    maximized?: boolean;
    focus?: string;
};

describe("AppManager app creation order", () => {
    let previousContainer: HTMLElement | undefined;

    beforeEach(() => {
        previousContainer = WindowManager.container;
        WindowManager.container = document.createElement("div");
    });

    afterEach(() => {
        WindowManager.container = previousContainer;
        vi.restoreAllMocks();
    });

    it("keeps synchronized flags but disables their effective box config without boxesStatus", () => {
        const params = { kind: "HelloWorld", forceTop: true, forceNormal: true };
        const resolve = (AppManager.prototype as any).resolveEffectiveAppWindowFlags;

        const globalMode = resolve.call({ useBoxesStatus: false }, params);
        const independentMode = resolve.call({ useBoxesStatus: true }, params);

        expect(globalMode).toEqual({
            kind: "HelloWorld",
            forceTop: undefined,
            forceNormal: undefined,
        });
        expect(independentMode).toBe(params);
        expect(params).toEqual({ kind: "HelloWorld", forceTop: true, forceNormal: true });
    });

    it("does not restore synchronized forceTop/forceNormal into global box mode", () => {
        const proxy = Object.create(AppProxy.prototype) as any;
        proxy.manager = {
            useBoxesStatus: false,
        };
        proxy.store = {
            getAppAttributes: () => ({
                forceTop: true,
                forceNormal: true,
                isDragContent: true,
            }),
        };

        expect((AppProxy.prototype as any).getEffectiveAppWindowFlags.call(proxy, "legacy")).toEqual({
            forceTop: undefined,
            forceNormal: undefined,
            isDragContent: true,
        });
    });

    const restoreApps = async ({
        useBoxesStatus = false,
        maximized,
        focus,
    }: ManagerOptions) => {
        const tasks: Array<() => Promise<unknown>> = [];
        const notifyAppsChange = vi.fn();
        const baseInsertApp = vi.fn().mockResolvedValue(undefined);
        const manager = {
            appCreateQueue: {
                emitReady: vi.fn(),
                push: (task: () => Promise<unknown>) => tasks.push(task),
            },
            appProxies: new Map(),
            appStatus: new Map(),
            attributes: {
                apps,
                maximized,
                oldest: {},
                focused: {},
                newest: {},
            },
            store: { focus },
            useBoxesStatus,
            notifyAppsChange,
            baseInsertApp,
            focusByAttributes: vi.fn(),
        };

        await AppManager.prototype._attributesUpdateCallback.call(manager as any, apps);
        for (const task of tasks) {
            await task();
        }

        return {
            creationOrder: baseInsertApp.mock.calls.map(([, appId]) => appId),
            notifiedOrder: notifyAppsChange.mock.calls[0]?.[0],
        };
    };

    it("creates the focused app first for a globally maximized workspace", async () => {
        const result = await restoreApps({ maximized: true, focus: "focused" });

        expect(result.creationOrder).toEqual(["focused", "oldest", "newest"]);
        expect(result.notifiedOrder).toEqual(["oldest", "focused", "newest"]);
    });

    it.each([
        ["independent box status is enabled", { useBoxesStatus: true, maximized: true, focus: "focused" }],
        ["the workspace is not maximized", { maximized: false, focus: "focused" }],
        ["the focused app is missing", { maximized: true, focus: "missing" }],
        ["there is no focused app", { maximized: true }],
    ])("keeps chronological order when %s", async (_description, options) => {
        const result = await restoreApps(options);

        expect(result.creationOrder).toEqual(["oldest", "focused", "newest"]);
        expect(result.notifiedOrder).toEqual(["oldest", "focused", "newest"]);
    });

    it("does not enqueue the same app twice while its creation task is pending", async () => {
        const tasks: Array<() => Promise<unknown>> = [];
        const manager = {
            appCreateQueue: {
                emitReady: vi.fn(),
                push: (task: () => Promise<unknown>) => tasks.push(task),
            },
            appProxies: new Map(),
            appStatus: new Map(),
            pendingAppIds: new Set<string>(),
            attributes: {
                apps,
                maximized: true,
                oldest: {},
                focused: {},
                newest: {},
            },
            store: { focus: "focused" },
            useBoxesStatus: false,
            notifyAppsChange: vi.fn(),
            baseInsertApp: vi.fn().mockResolvedValue(undefined),
            focusByAttributes: vi.fn(),
        };

        await AppManager.prototype._attributesUpdateCallback.call(manager as any, apps);
        await AppManager.prototype._attributesUpdateCallback.call(manager as any, apps);

        expect(tasks).toHaveLength(3);
    });

    it("queues a new lazy app's focus only after its proxy exists", async () => {
        const manager = Object.create(AppManager.prototype) as any;
        manager.windowManger = {
            lazySetupInMaximizedMode: true,
            Logger: { info: vi.fn(), warn: vi.fn() },
            attributes: { apps: { next: {} } },
        };
        manager.beforeAddApp = vi.fn().mockResolvedValue({ appId: "next", needFocus: true });
        manager.baseInsertApp = vi.fn().mockResolvedValue({ id: "next" });
        manager.afterAddApp = vi.fn();
        manager.requestFocus = vi.fn();

        await AppManager.prototype.addApp.call(manager, { kind: "Slide" }, false);

        expect(manager.baseInsertApp).toHaveBeenCalledOnce();
        expect(manager.afterAddApp).toHaveBeenCalledWith({ id: "next" });
        expect(manager.requestFocus).toHaveBeenCalledWith("next", true);
    });

    it("does not publish room focus while creating a lazy app", async () => {
        const manager = Object.create(AppManager.prototype) as any;
        manager.windowManger = { lazySetupInMaximizedMode: true };
        manager.appStatus = new Map();
        manager.boxManager = { minimized: false };
        manager.safeUpdateAttributes = vi.fn();
        manager.store = {
            setupAppAttributes: vi.fn(),
            setAppFocus: vi.fn(),
        };

        const result = await (AppManager.prototype as any).beforeAddApp.call(
            manager, { kind: "Slide" }, false
        );

        expect(result.needFocus).toBe(true);
        expect(manager.store.setAppFocus).not.toHaveBeenCalled();
    });
});
