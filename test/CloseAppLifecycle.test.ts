import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { appRegister } from "../src/Register";
import { internalEmitter } from "../src/InternalEmitter";
import { Events } from "../src/constants";
import { AttributesDelegate } from "../src/AttributesDelegate";
import { isRoom, ScenePathType } from "white-web-sdk";
import { WindowManager } from "../src/index";

vi.mock("white-web-sdk", async () => ({
    ...(await import("../__mocks__/white-web-sdk")),
    isRoom: vi.fn(() => false),
    ScenePathType: { None: "none", Dir: "dir" },
}));
vi.mock("../src/index", () => ({
    WindowManager: class {
        static extendClass = undefined;
    },
}));
vi.mock("../src/Utils/extendClass", () => ({ getExtendClass: (base: unknown) => base }));
let ProxyClass: any;
let ManagerClass: any;
beforeAll(async () => {
    (globalThis as any).CanvasRenderingContext2D = class {};
    ProxyClass = (await import("../src/App/AppProxy")).AppProxy;
    ManagerClass = (await import("../src/AppManager")).AppManager;
});
beforeEach(() => {
    vi.mocked(isRoom).mockReturnValue(false);
    WindowManager.container = document.createElement("div");
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    WindowManager.container = undefined;
    appRegister.appClasses.delete("ReviewApp");
    internalEmitter.clearListeners(`${"app-1"}${Events.WindowCreated}` as any);
});
const deferred = () => {
    let resolve!: (value?: any) => void;
    const promise = new Promise<any>(r => {
        resolve = r;
    });
    return { promise, resolve };
};
function fixture(setup = false, cached = false, lazy = true) {
    const manager = Object.create(ManagerClass.prototype);
    const attrs: any = {
        apps: { "app-1": { kind: "ReviewApp", options: { scenePath: "/deck" } } },
        "app-1": {},
        focus: "app-1",
    };
    const store = new AttributesDelegate({
        getAttributes: () => attrs,
        safeSetAttributes: (patch: any) => Object.assign(attrs, patch),
        safeUpdateAttributes: (keys: string[], value: any) => {
            attrs[keys[0]][keys[1]] = value;
        },
    } as any);
    vi.spyOn(store, "cleanAppAttributes");
    Object.assign(manager, {
        windowManger: {
            attributes: attrs,
            lazySetupInMaximizedMode: lazy,
            canOperate: true,
            resolveAppOptions: () => ({}),
            Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        runtimeCache: new Map(cached ? [["app-1", { state: "ready", lastUsed: 1 }]] : []),
        lazyFocusGeneration: 0,
        settingUpApps: new Map(),
        appProxies: new Map(),
        appStatus: new Map(),
        pendingAppIds: new Set(),
        store,
        refresher: { remove: vi.fn() },
        viewManager: { destroyView: vi.fn() },
        displayer: { removeMagixEventListener: vi.fn() },
    });
    const proxy = Object.create(ProxyClass.prototype);
    Object.assign(proxy, {
        manager,
        id: "app-1",
        kind: "ReviewApp",
        params: { kind: "ReviewApp", lazySetup: lazy },
        status: "normal",
        setupSucceeded: setup,
        setupStarted: setup,
        setupRunGeneration: 0,
        setupCompletionSettled: false,
        resolveSetupCompletion: vi.fn(),
        appProxies: manager.appProxies,
        viewManager: manager.viewManager,
        store,
        boxManager: { closeBox: vi.fn(), createBox: vi.fn(), getBox: vi.fn() },
        appEmitter: { emit: vi.fn().mockResolvedValue(undefined), clearListeners: vi.fn() },
        boxSizeSynchronizer: { destroy: vi.fn() },
        _pageState: { destroy: vi.fn() },
    });
    manager.appProxies.set(proxy.id, proxy);
    return { manager, proxy };
}

it.each([
    [true, true, true],
    [true, false, true],
    [false, false, true],
    [true, false, false],
    [false, false, false],
])("stable close cleanup: setup=%s cached=%s lazy=%s", async (setup, cached, lazy) => {
    const { manager, proxy } = fixture(setup, cached, lazy);
    proxy.kind = "Slide";
    manager.activeLazyAppId = "app-1";
    const ensureSetup = vi.spyOn(proxy, "ensureSetup");
    await manager.closeApp("app-1");
    expect(ensureSetup).not.toHaveBeenCalled();
    expect(manager.runtimeCache.has("app-1")).toBe(false);
    expect(manager.appProxies.has("app-1")).toBe(false);
    expect(manager.activeLazyAppId).toBeUndefined();
    expect(proxy.appEmitter.emit).toHaveBeenCalledWith("destroy", { error: undefined });
    expect(proxy.viewManager.destroyView).toHaveBeenCalledWith("app-1");
    expect(proxy.store.cleanAppAttributes).toHaveBeenCalledWith("app-1", false);
    expect(manager.attributes.apps["app-1"]).toBeUndefined();
    expect(manager.attributes.focus).toBeUndefined();
});

it.each([true, false])(
    "closing a focused app chooses the highest remaining Box, cached=%s",
    async cached => {
        const { manager, proxy } = fixture(true, true);
        manager.runtimeCache.set("app-2", { state: cached ? "ready" : "evicted", lastUsed: 2 });
        manager.attributes.apps["app-2"] = { kind: "ReviewApp", state: { zIndex: 102 } };
        manager.attributes.apps["app-3"] = { kind: "ReviewApp", state: { zIndex: 101 } };
        manager.appProxies.set("app-2", { isDestroyed: false });
        manager.appProxies.set("app-3", { isDestroyed: false });
        manager.boxManager = {
            getBox: vi.fn((id: string) => ({ "app-2": { zIndex: 102 }, "app-3": { zIndex: 101 } })[id]),
            boxIsFocus: vi.fn(() => false),
        };
        const requestFocus = vi.spyOn(manager, "requestFocus").mockImplementation(() => undefined);

        await manager.closeApp("app-1");

        expect(proxy.store.cleanAppAttributes).toHaveBeenCalledWith("app-1", true);
        expect(manager.attributes.focus).toBe("app-1");
        expect(requestFocus).toHaveBeenCalledTimes(1);
        expect(requestFocus).toHaveBeenCalledWith("app-2");
    }
);

it("closing another app preserves an existing valid focus", async () => {
    const { manager } = fixture(true, false);
    manager.attributes.apps["app-2"] = { kind: "ReviewApp", state: { zIndex: 102 } };
    manager.attributes.focus = "app-2";
    manager.appProxies.set("app-2", { isDestroyed: false });
    const requestFocus = vi.spyOn(manager, "requestFocus").mockImplementation(() => undefined);

    await manager.closeApp("app-1");

    expect(manager.attributes.focus).toBe("app-2");
    expect(requestFocus).not.toHaveBeenCalled();
});

it("repairs an empty focus after closing an app while another Box remains", async () => {
    const { manager } = fixture(true, false);
    manager.attributes.apps["app-2"] = { kind: "ReviewApp", state: { zIndex: 102 } };
    manager.attributes.focus = null;
    manager.appProxies.set("app-2", { isDestroyed: false });
    const requestFocus = vi.spyOn(manager, "requestFocus").mockImplementation(() => undefined);

    await manager.closeApp("app-1");

    expect(requestFocus).toHaveBeenCalledTimes(1);
    expect(requestFocus).toHaveBeenCalledWith("app-2");
});

it.each([undefined, "app-3"])(
    "a newer focus intent takes precedence over close handoff: %s",
    async focused => {
        const { manager, proxy } = fixture(true, false);
        manager.attributes.apps["app-2"] = { kind: "ReviewApp", state: { zIndex: 102 } };
        manager.attributes.apps["app-3"] = { kind: "ReviewApp", state: { zIndex: 101 } };
        manager.appProxies.set("app-2", { isDestroyed: false });
        manager.appProxies.set("app-3", { isDestroyed: false });
        const gate = deferred();
        proxy.appEmitter.emit.mockReturnValue(gate.promise);
        const requestFocus = vi.spyOn(manager, "requestFocus").mockImplementation(() => undefined);

        const closing = manager.closeApp("app-1");
        for (let i = 0; i < 10; i++) await Promise.resolve();
        manager.lazyFocusGeneration = 1;
        manager.desiredLazyFocus = { focused, generation: 1 };
        gate.resolve();
        await closing;

        expect(requestFocus).not.toHaveBeenCalled();
    }
);

it("addApp does not create a proxy after close during attribute preparation", async () => {
    const { manager } = fixture();
    manager.appProxies.clear();
    manager.beforeAddApp = vi.fn(async () => {
        await manager.closeApp("app-1");
        return { appId: "app-1", needFocus: true };
    });
    manager.baseInsertApp = vi.fn();
    manager.afterAddApp = vi.fn();
    expect(await manager.addApp({ kind: "ReviewApp" }, false)).toBeUndefined();
    expect(manager.baseInsertApp).not.toHaveBeenCalled();
    expect(manager.afterAddApp).not.toHaveBeenCalled();
    expect(manager.appStatus.has("app-1")).toBe(false);
});

it("both close calls wait for the same runtime destruction", async () => {
    const { manager, proxy } = fixture(true, true);
    const gate = deferred();
    proxy.appEmitter.emit.mockReturnValue(gate.promise);
    let firstDone = false;
    const first = manager.closeApp("app-1").then(() => {
        firstDone = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let secondDone = false;
    const second = manager.closeApp("app-1").then(() => {
        secondDone = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    expect(proxy.viewManager.destroyView).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([first, second]);
    expect(proxy.appEmitter.emit).toHaveBeenCalledOnce();
    expect(proxy.viewManager.destroyView).toHaveBeenCalledOnce();
});

it.each([true, false])("late app factory cannot create a box after close; lazy=%s", async lazy => {
    const { manager, proxy } = fixture(false, false, lazy);
    const factory = deferred();
    appRegister.appClasses.set("ReviewApp", () => factory.promise);
    const inserting = proxy.baseInsertApp(true);
    const rejected = expect(inserting).rejects.toThrow("destroyed before setup");
    await manager.closeApp("app-1");
    expect(proxy.boxManager.createBox).not.toHaveBeenCalled();
    factory.resolve({ kind: "ReviewApp", setup: vi.fn() });
    await rejected;
    expect(proxy.isDestroyed).toBe(true);
    expect(manager.appProxies.has("app-1")).toBe(false);
    expect(proxy.boxManager.createBox).not.toHaveBeenCalled();
});

it("close removes synchronized attributes/scenes even before a proxy exists", async () => {
    const { manager, proxy } = fixture();
    manager.appProxies.clear();
    manager.pendingAppIds = new Set(["app-1"]);
    vi.mocked(isRoom).mockReturnValue(true);
    manager.displayer.scenePathType = vi.fn(() => ScenePathType.Dir);
    manager.displayer.removeScenes = vi.fn();
    await manager.closeApp("app-1");
    expect(proxy.store.cleanAppAttributes).toHaveBeenCalledWith("app-1", false);
    expect(manager.pendingAppIds.has("app-1")).toBe(false);
    expect(manager.displayer.removeScenes).toHaveBeenCalledWith("/deck", undefined);
    expect(manager.attributes.apps["app-1"]).toBeUndefined();
});

it("rejected registration hook still delivers and awaits runtime destroy", async () => {
    const { manager, proxy } = fixture(true, true);
    vi.spyOn(appRegister, "notifyApp").mockRejectedValueOnce(new Error("customer destroy hook"));
    const gate = deferred();
    proxy.appEmitter.emit.mockReturnValue(gate.promise);
    const closing = manager.closeApp("app-1");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(proxy.appEmitter.emit).toHaveBeenCalledWith("destroy", { error: undefined });
    expect(proxy.viewManager.destroyView).not.toHaveBeenCalled();
    gate.resolve();
    await closing;
    expect(proxy.appEmitter.clearListeners).toHaveBeenCalled();
    expect(proxy.viewManager.destroyView).toHaveBeenCalled();
});

it.each(["close", "remote-delete", "manager-destroy"])(
    "queued creation checks cancellation: %s",
    async reason => {
        vi.useFakeTimers();
        const { manager } = fixture();
        manager.appProxies.clear();
        manager.requestFocus = vi.fn();
        manager.attributes.apps["app-2"] = { kind: "ReviewApp", createdAt: 2 };
        manager.attributes["app-2"] = {};
        const tasks: Array<() => Promise<unknown>> = [];
        manager.appCreateQueue = { push: (task: () => Promise<unknown>) => tasks.push(task) };
        manager.notifyAppsChange = vi.fn();
        manager.focusByAttributes = vi.fn();
        manager.baseInsertApp = vi.fn().mockResolvedValue(undefined);
        await manager._attributesUpdateCallback(manager.attributes.apps);
        expect(tasks).toHaveLength(2);
        if (reason === "close") await manager.closeApp("app-1");
        if (reason === "remote-delete") delete manager.attributes.apps["app-1"];
        if (reason === "manager-destroy") manager.destroyed = true;
        for (const task of tasks) await task();
        expect(manager.baseInsertApp.mock.calls.map((args: any[]) => args[1])).toEqual(
            reason === "manager-destroy" ? [] : ["app-2"]
        );
    }
);

it("local-only close cancels pending creation without deleting shared data", async () => {
    const { manager, proxy } = fixture();
    manager.appProxies.clear();
    manager.pendingAppIds.add("app-1");
    await manager.closeApp("app-1", false);
    expect(manager.pendingAppIds.has("app-1")).toBe(false);
    expect(proxy.store.cleanAppAttributes).not.toHaveBeenCalled();
    expect(manager.attributes.apps["app-1"]).toBeDefined();
    expect(manager.attributes.focus).toBe("app-1");
    await manager.closeApp("unknown");
    expect(proxy.store.cleanAppAttributes).not.toHaveBeenCalled();
});

it.each([true, false])(
    "late WindowCreated cannot attach a destroyed proxy; lazy=%s",
    async lazy => {
        const { manager, proxy } = fixture(false, false, lazy);
        appRegister.appClasses.set("ReviewApp", async () => ({
            kind: "ReviewApp",
            setup: vi.fn(),
        }));
        const attach = vi.spyOn(proxy, "attachSetupScope").mockImplementation(() => undefined);
        const focus = vi.spyOn(proxy, "setViewFocusScenePath").mockImplementation(() => undefined);
        manager.enqueueEagerSetup = vi.fn();
        await proxy.baseInsertApp(true);
        expect(proxy.boxManager.createBox).toHaveBeenCalledOnce();
        await manager.closeApp("app-1");
        await internalEmitter.emit(`app-1${Events.WindowCreated}` as any);
        expect(attach).not.toHaveBeenCalled();
        expect(focus).not.toHaveBeenCalled();
        expect(manager.enqueueEagerSetup).not.toHaveBeenCalled();
        expect(proxy.deferredSetup).toBeUndefined();
    }
);

it("eager hand-off timer does not enqueue setup after close", async () => {
    vi.useFakeTimers();
    const { manager, proxy } = fixture(false, false, false);
    appRegister.appClasses.set("ReviewApp", async () => ({ kind: "ReviewApp", setup: vi.fn() }));
    vi.spyOn(proxy, "attachSetupScope").mockImplementation(() => undefined);
    vi.spyOn(proxy, "setViewFocusScenePath").mockImplementation(() => undefined);
    manager.enqueueEagerSetup = vi.fn();
    await proxy.baseInsertApp(true);
    await internalEmitter.emit(`app-1${Events.WindowCreated}` as any);
    expect(proxy.deferredSetup).toBeDefined();
    await manager.closeApp("app-1");
    vi.runAllTimers();
    expect(manager.enqueueEagerSetup).not.toHaveBeenCalled();
});

it("reentrant destroy shares the published completion promise", async () => {
    const { proxy } = fixture(true, true);
    let reentrant: Promise<void> | undefined;
    proxy.boxSizeSynchronizer.destroy.mockImplementation(() => {
        reentrant = proxy.destroy(true, true, false);
    });
    const closing = proxy.destroy(true, true, false);
    expect(reentrant).toBe(closing);
    await closing;
    expect(proxy.destroy(true, true, false)).toBe(closing);
    expect(proxy.boxSizeSynchronizer.destroy).toHaveBeenCalledOnce();
    expect(proxy.appEmitter.emit).toHaveBeenCalledOnce();
});

it("runtime destroy rejection still cleans the cache, view, box and attributes", async () => {
    const { manager, proxy } = fixture(true, true);
    proxy.appEmitter.emit.mockRejectedValueOnce(new Error("runtime destroy failure"));
    await manager.closeApp("app-1");
    expect(manager.runtimeCache.has("app-1")).toBe(false);
    expect(manager.appProxies.has("app-1")).toBe(false);
    expect(proxy.viewManager.destroyView).toHaveBeenCalledOnce();
    expect(proxy.boxManager.closeBox).toHaveBeenCalledOnce();
    expect(proxy.appEmitter.clearListeners).toHaveBeenCalledOnce();
    expect(manager.attributes.apps["app-1"]).toBeUndefined();
});
