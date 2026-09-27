import { afterEach, expect, it, vi } from "vitest";
vi.mock("white-web-sdk", async () => ({ ...(await import("../__mocks__/white-web-sdk")), isRoom: () => false }));
vi.mock("../src/View/MainView", () => ({ MainViewProxy: class {} }));
import { AppManager, LazySetupWaitError } from "../src/AppManager";
import { SetupQueue } from "../src/Utils/SetupQueue";

const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { resolve, promise };
};

function fixture(real = false) {
    vi.useFakeTimers();
    const attributes = { focus: undefined as string | undefined, apps: {}, minimized: false };
    const windowManger = { lazySetupInMaximizedMode: true, maxCachedAppsInMaximizedMode: 3,
        canOperate: true, attributes, Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        displayer: { callbacks: { on: vi.fn() }, createScenesCallback: vi.fn(), addMagixEventListener: vi.fn() },
    };
    const manager = real ? new AppManager(windowManger as any) as any : Object.create(AppManager.prototype);
    Object.assign(manager, {
        windowManger,
        appProxies: new Map(), runtimeCache: new Map(), settingUpApps: new Map(),
        setupTaskQueue: new SetupQueue(), setupStartedAt: new Map(), lruClock: 0,
        lazyFocusGeneration: 0, activityRevision: 0, lazyFocusQueue: Promise.resolve(),
        focusCommitWatchdogTimeout: 30_000,
        boxManager: { getBox: vi.fn(), focusBox: vi.fn(), blurAllBox: vi.fn(), getFocusBox: vi.fn() },
    });
    manager.store = {
        get focus() { return attributes.focus ?? undefined; },
        setAppFocus: (id: string) => focus(id),
        cleanFocus: () => focus(undefined),
    };
    function focus(id: string | undefined) {
        attributes.focus = id;
        manager.handleFocusChange(id);
    }
    manager.windowManger.safeSetAttributes = ({ focus: id }: { focus: string }) => focus(id);
    function app(id: string, setup = Promise.resolve()) {
        (attributes.apps as Record<string, unknown>)[id] = {};
        const proxy = { kind: "Slide", isSetup: false, isDestroyed: false, canTeardown: true,
            teardown: vi.fn(), emitAppFocusEvent: vi.fn().mockResolvedValue(true),
            emitAppActivityEvent: vi.fn().mockResolvedValue(true),
            setViewFocusScenePath: vi.fn(),
            setScenePath: vi.fn(),
            ensureSetup: vi.fn(async () => { await setup; proxy.isSetup = true; }) };
        manager.appProxies.set(id, proxy);
        return proxy;
    }
    return { manager, attributes, focus, app };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps focus and zIndex unchanged during setup, then commits one reserved level", async () => {
    const f = fixture();
    const setup = deferred();
    const previous = f.app("A");
    previous.isSetup = true;
    f.app("B", setup.promise);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    const boxes: Record<string, { zIndex: number }> = {
        A: { zIndex: 315 }, B: { zIndex: 300 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.getTopBox = vi.fn((exclude?: string) =>
        Object.entries(boxes).filter(([id]) => id !== exclude)
            .sort((a, b) => b[1].zIndex - a[1].zIndex)[0]?.[1]);
    f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
        boxes[id].zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const focus = f.manager.requestFocusAndWait("B");
    await flush();
    expect(previous.emitAppFocusEvent).toHaveBeenCalledWith(false);
    expect(f.attributes.focus).toBe("A");
    expect(boxes.B.zIndex).toBe(300);
    expect(f.manager.boxManager.focusBox).not.toHaveBeenCalledWith({ appId: "B" });

    setup.resolve();
    await flush();
    expect(await focus).toBe(true);
    expect(f.attributes.focus).toBe("B");
    expect(boxes.B.zIndex).toBe(316);
    expect(f.manager.boxManager.setZIndex).toHaveBeenCalledTimes(1);
});

it("commits only the latest local focus after a hung setup yields at 10s", async () => {
    const f = fixture();
    const firstSetup = deferred();
    const latestSetup = deferred();
    const previous = f.app("previous");
    previous.isSetup = true;
    const first = f.app("first", firstSetup.promise);
    const latest = f.app("latest", latestSetup.promise);
    f.attributes.focus = "previous";
    f.manager._prevFocused = "previous";
    f.manager.activeLazyAppId = "previous";
    const boxes: Record<string, { zIndex: number }> = {
        previous: { zIndex: 100 }, first: { zIndex: 99 }, latest: { zIndex: 98 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.getTopBox = vi.fn((exclude?: string) =>
        Object.entries(boxes).filter(([id]) => id !== exclude)
            .sort((a, b) => b[1].zIndex - a[1].zIndex)[0]?.[1]);
    f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
        boxes[id].zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const obsoleteFocus = f.manager.requestFocusAndWait("first");
    await flush();
    expect(first.ensureSetup).toHaveBeenCalledOnce();
    const latestFocus = f.manager.requestFocusAndWait("latest");
    expect(await obsoleteFocus).toBe(false);
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(latest.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("previous");
    expect(boxes.latest.zIndex).toBe(98);

    latestSetup.resolve();
    await flush();
    expect(await latestFocus).toBe(true);
    expect(f.attributes.focus).toBe("latest");
    expect(f.manager.activeLazyAppId).toBe("latest");
    expect(boxes.latest.zIndex).toBe(101);

    firstSetup.resolve();
    await flush();
    expect(f.attributes.focus).toBe("latest");
    expect(f.manager.activeLazyAppId).toBe("latest");
    expect(boxes.latest.zIndex).toBe(101);
    expect(first.setScenePath).not.toHaveBeenCalled();
});

it("raises a cached app once on focus without running setup again", async () => {
    const f = fixture();
    const previous = f.app("previous");
    previous.isSetup = true;
    const cached = f.app("cached");
    cached.isSetup = true;
    f.manager.runtimeCache.set("cached", { lastUsed: 1, state: "ready" });
    f.attributes.focus = "previous";
    f.manager._prevFocused = "previous";
    f.manager.activeLazyAppId = "previous";
    const boxes: Record<string, { zIndex: number }> = {
        previous: { zIndex: 101 }, cached: { zIndex: 100 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.getTopBox = vi.fn((exclude?: string) =>
        Object.entries(boxes).filter(([id]) => id !== exclude)
            .sort((a, b) => b[1].zIndex - a[1].zIndex)[0]?.[1]);
    f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
        boxes[id].zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    expect(await f.manager.requestFocusAndWait("cached")).toBe(true);
    expect(cached.ensureSetup).not.toHaveBeenCalled();
    expect(boxes.cached.zIndex).toBe(102);
    expect(f.attributes.focus).toBe("cached");
});

it("keeps a target's higher setup zIndex when focus commits", async () => {
    const f = fixture();
    const previous = f.app("previous");
    previous.isSetup = true;
    f.app("target");
    f.attributes.focus = "previous";
    f.manager._prevFocused = "previous";
    f.manager.activeLazyAppId = "previous";
    const boxes: Record<string, { zIndex: number }> = {
        previous: { zIndex: 101 }, target: { zIndex: 103 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.getTopBox = vi.fn((exclude?: string) =>
        Object.entries(boxes).filter(([id]) => id !== exclude)
            .sort((a, b) => b[1].zIndex - a[1].zIndex)[0]?.[1]);
    f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
        boxes[id].zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    expect(await f.manager.requestFocusAndWait("target")).toBe(true);
    expect(boxes.target.zIndex).toBe(103);
    expect(f.manager.boxManager.setZIndex).not.toHaveBeenCalled();
});

it("does not let addApp attribute reconciliation replace a pending lazy focus", async () => {
    const f = fixture();
    const setup = deferred();
    const previous = f.app("A");
    previous.isSetup = true;
    const target = f.app("B", setup.promise);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    f.manager.boxManager.boxSize = 2;
    f.manager.beforeAddApp = vi.fn().mockResolvedValue({ appId: "B", needFocus: true });
    f.manager.baseInsertApp = vi.fn().mockResolvedValue({ id: "B" });
    f.manager.afterAddApp = vi.fn();

    expect(await f.manager.addApp({ kind: "Slide" }, false)).toBe("B");
    await flush();
    const generation = f.manager.lazyFocusGeneration;
    f.manager.focusByAttributes(f.attributes.apps);

    expect(f.manager.desiredLazyFocus?.focused).toBe("B");
    expect(f.manager.lazyFocusGeneration).toBe(generation);
    expect(f.attributes.focus).toBe("A");

    setup.resolve();
    await flush();
    expect(target.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("B");
    expect(f.manager.activeLazyAppId).toBe("B");
});

it("keeps the latest addApp pending until an in-flight setup finishes, even after 10s", async () => {
    const f = fixture();
    const running = deferred();
    const a = f.app("A", running.promise);
    const b = f.app("B");
    const c = f.app("C");
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.boxManager.boxSize = 3;
    const setupA = f.manager.enqueueAppSetup("A");
    await flush();
    expect(a.ensureSetup).toHaveBeenCalledOnce();
    f.manager.beforeAddApp = vi.fn()
        .mockResolvedValueOnce({ appId: "B", needFocus: true })
        .mockResolvedValueOnce({ appId: "C", needFocus: true });
    f.manager.baseInsertApp = vi.fn()
        .mockResolvedValueOnce({ id: "B" })
        .mockResolvedValueOnce({ id: "C" });
    f.manager.afterAddApp = vi.fn();

    expect(await f.manager.addApp({ kind: "Slide" }, false)).toBe("B");
    expect(await f.manager.addApp({ kind: "Slide" }, false)).toBe("C");
    vi.advanceTimersByTime(10_001);
    await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(c.ensureSetup).not.toHaveBeenCalled();
    expect(f.attributes.focus).toBe("A");

    running.resolve();
    await setupA;
    await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(c.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("C");
});

it("waits for physical setup before addApp even when its scheduling lease yielded", async () => {
    const f = fixture();
    const running = deferred();
    f.app("A", running.promise);
    const b = f.app("B");
    f.app("C");
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    const setupA = f.manager.enqueueAppSetup("A");
    await flush();
    f.focus("C");
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(f.manager.setupStartedAt.has("A")).toBe(true);

    f.manager.beforeAddApp = vi.fn().mockResolvedValue({ appId: "B", needFocus: true });
    f.manager.baseInsertApp = vi.fn().mockResolvedValue({ id: "B" });
    f.manager.afterAddApp = vi.fn();
    expect(await f.manager.addApp({ kind: "Slide" }, false)).toBe("B");
    vi.advanceTimersByTime(10_001);
    await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();

    running.resolve();
    await setupA;
    await flush();
    expect(b.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("B");
});

it("preserves the first box's initial zIndex when there is no previous box", async () => {
    const f = fixture();
    f.app("B");
    const box = { zIndex: 300 };
    f.manager.boxManager.getBox = vi.fn((id: string) => id === "B" ? box : undefined);
    f.manager.boxManager.getTopBox = vi.fn(() => undefined);
    f.manager.boxManager.setZIndex = vi.fn((_: string, zIndex: number) => {
        box.zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const focus = f.manager.requestFocusAndWait("B");
    await flush();

    expect(await focus).toBe(true);
    expect(f.attributes.focus).toBe("B");
    expect(box.zIndex).toBe(300);
    expect(f.manager.boxManager.setZIndex).not.toHaveBeenCalled();
});

it("does not raise the first box when its focus arrives from attributes", async () => {
    const f = fixture();
    f.app("B");
    const box = { zIndex: 300 };
    f.manager.boxManager.getBox = vi.fn((id: string) => id === "B" ? box : undefined);
    f.manager.boxManager.getTopBox = vi.fn(() => undefined);
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    f.focus("B");
    await flush();

    expect(f.manager.activeLazyAppId).toBe("B");
    expect(f.manager.boxManager.setZIndex).not.toHaveBeenCalled();
});

it("reuses the same reserved zIndex when a pending target is replaced", async () => {
    const f = fixture();
    const blocked = deferred();
    const previous = f.app("A");
    previous.isSetup = true;
    f.app("B", blocked.promise);
    f.app("C");
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    const boxes: Record<string, { zIndex: number }> = {
        A: { zIndex: 315 }, B: { zIndex: 300 }, C: { zIndex: 299 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
        boxes[id].zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const first = f.manager.requestFocusAndWait("B");
    await flush();
    const second = f.manager.requestFocusAndWait("C");
    expect(await first).toBe(false);
    expect(f.attributes.focus).toBe("A");
    expect(boxes.B.zIndex).toBe(300);
    expect(boxes.C.zIndex).toBe(299);

    blocked.resolve();
    await flush();
    expect(await second).toBe(true);
    expect(f.attributes.focus).toBe("C");
    expect(boxes.B.zIndex).toBe(300);
    expect(boxes.C.zIndex).toBe(316);
    expect(f.manager.boxManager.setZIndex).toHaveBeenCalledTimes(1);
});

it("coalesces repeated requests for the same pending target", async () => {
    const f = fixture();
    const blocked = deferred();
    const previous = f.app("A");
    previous.isSetup = true;
    const target = f.app("B", blocked.promise);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";

    f.manager.requestFocus("B");
    await flush();
    f.manager.requestFocus("B");
    expect(f.manager.lazyFocusGeneration).toBe(1);
    expect(target.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("A");

    blocked.resolve();
    await flush();
    expect(f.attributes.focus).toBe("B");
});

it("skips a stable TeleBox focus request but lets the active box replace a pending target", async () => {
    const f = fixture();
    const blocked = deferred();
    const previous = f.app("A");
    previous.isSetup = true;
    f.app("B", blocked.promise);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    f.manager.boxManager.boxIsFocus = vi.fn((appId: string) => appId === "A");

    f.manager.requestFocusFromTeleBox("A");
    expect(f.manager.lazyFocusGeneration).toBe(0);
    expect(f.manager.desiredLazyFocus).toBeUndefined();

    f.manager.requestFocus("B");
    await flush();
    expect(f.manager.pendingLazyFocusAppId).toBe("B");
    f.manager.requestFocusFromTeleBox("A");
    await flush();
    expect(f.manager.desiredLazyFocus.focused).toBe("A");
    expect(f.manager.lazyFocusGeneration).toBe(2);
    expect(f.attributes.focus).toBe("A");

    blocked.resolve();
    await flush();
    expect(f.attributes.focus).toBe("A");
});

it("keeps the pending focus and zIndex locked after the API watchdog expires", async () => {
    const f = fixture();
    const blocked = deferred();
    const previous = f.app("A");
    previous.isSetup = true;
    f.app("B", blocked.promise);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    const boxes: Record<string, { zIndex: number }> = {
        A: { zIndex: 315 }, B: { zIndex: 300 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
        boxes[id].zIndex = zIndex;
    });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const focus = f.manager.requestFocusAndWait("B");
    await flush();
    vi.advanceTimersByTime(30_000);
    await flush();
    expect(await focus).toBe(false);
    expect(f.attributes.focus).toBe("A");
    expect(boxes.B.zIndex).toBe(300);
    expect(f.manager.pendingLazyZIndex).toEqual({ appId: "B", base: 315 });

    blocked.resolve();
    await flush();
    expect(f.attributes.focus).toBe("B");
    expect(boxes.B.zIndex).toBe(316);
});

it("keeps the created Box focused when its setup fails", async () => {
    const f = fixture();
    let rejectSetup!: (error: Error) => void;
    const setup = new Promise<void>((_, reject) => { rejectSetup = reject; });
    const previous = f.app("A");
    previous.isSetup = true;
    f.app("B", setup);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    const boxes: Record<string, { zIndex: number }> = {
        A: { zIndex: 315 }, B: { zIndex: 300 },
    };
    f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const focus = f.manager.requestFocusAndWait("B");
    await flush();
    rejectSetup(new Error("setup failed"));
    await flush();

    expect(await focus).toBe(false);
    expect(previous.emitAppFocusEvent.mock.calls.map(([focused]: [boolean]) => focused))
        .toEqual([false]);
    expect(f.attributes.focus).toBe("B");
    expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
    expect(f.manager.boxManager.setZIndex).toHaveBeenCalledWith("B", 316);
    expect(f.manager.appProxies.get("B").isSetup).toBe(false);
    expect(f.manager.failedSetupFocusAppId).toBe("B");
});

it("does not replay an old zIndex when focusing the failed Box", async () => {
    const f = fixture();
    let rejectSetup!: (error: Error) => void;
    const setup = new Promise<void>((_, reject) => { rejectSetup = reject; });
    const previous = f.app("A");
    previous.isSetup = true;
    previous.flushPendingZIndex = vi.fn();
    f.app("B", setup);
    f.attributes.focus = "A";
    f.manager._prevFocused = "A";
    f.manager.activeLazyAppId = "A";
    f.manager.boxManager.getBox = vi.fn((id: string) => ({ id, zIndex: id === "A" ? 315 : 300 }));
    f.manager.boxManager.getTopBox = vi.fn(() => ({ id: "A", zIndex: 315 }));
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const focus = f.manager.requestFocusAndWait("B");
    await flush();
    rejectSetup(new Error("setup failed"));
    await flush();

    expect(await focus).toBe(false);
    expect(previous.flushPendingZIndex).not.toHaveBeenCalled();
    expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
    expect(f.attributes.focus).toBe("B");
});

it("leaves a failed Box visible until an explicit refocus retries setup", async () => {
    const f = fixture();
    const box = { id: "B", zIndex: 100 };
    const app = f.app("B");
    app.ensureSetup = vi.fn().mockRejectedValueOnce(new Error("setup failed"))
        .mockImplementation(async () => { app.isSetup = true; });
    f.manager.boxManager.getBox = vi.fn(() => box);
    f.manager.boxManager.getTopBox = vi.fn(() => undefined);
    f.manager.boxManager.setZIndex = vi.fn((_: string, zIndex: number) => { box.zIndex = zIndex; });
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    expect(await f.manager.requestFocusAndWait("B")).toBe(false);
    expect(f.attributes.focus).toBe("B");
    expect(app.isSetup).toBe(false);
    f.manager.refreshLazyActivity(); await flush();
    expect(app.ensureSetup).toHaveBeenCalledTimes(1);

    expect(await f.manager.requestFocusAndWait("B")).toBe(true);
    expect(app.ensureSetup).toHaveBeenCalledTimes(2);
    expect(app.isSetup).toBe(true);
});

it("does not focus a failed setup after a newer target replaces it", async () => {
    const f = fixture();
    let rejectSetup!: (error: Error) => void;
    f.app("B", new Promise<void>((_, reject) => { rejectSetup = reject; }));
    const latest = f.app("C");
    const boxes = { B: { id: "B", zIndex: 100 }, C: { id: "C", zIndex: 101 } };
    f.manager.boxManager.getBox = vi.fn((id: "B" | "C") => boxes[id]);
    f.manager.boxManager.getTopBox = vi.fn(() => boxes.C);
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    const oldFocus = f.manager.requestFocusAndWait("B"); await flush();
    const newFocus = f.manager.requestFocusAndWait("C");
    rejectSetup(new Error("setup failed")); await flush();

    expect(await oldFocus).toBe(false);
    expect(await newFocus).toBe(true);
    expect(latest.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("C");
    expect(f.manager.boxManager.focusBox).not.toHaveBeenCalledWith({ appId: "B" });
});

it("recovers the highest Box during forceMaximized initialization", async () => {
    const f = fixture();
    const app = f.app("B");
    const box = { id: "B", zIndex: 101 };
    f.manager.windowManger.forceMaximized = true;
    f.manager.initialFocusRecoveryPending = true;
    f.manager.initialFocusRecoveryAppIds = new Set(["B"]);
    f.manager.boxManager.boxSize = 1;
    f.manager.boxManager.getTopBox = vi.fn(() => box);
    f.manager.boxManager.getBox = vi.fn(() => box);
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    f.manager.focusByAttributes(f.attributes.apps); await flush();

    expect(f.attributes.focus).toBe("B");
    expect(app.ensureSetup).toHaveBeenCalledOnce();
    expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
});

it.each([true, false])(
    "recovers an initial focus pointing to a deleted App; writable=%s",
    async writable => {
        const f = fixture();
        const app = f.app("B");
        const box = { id: "B", zIndex: 101 };
        f.attributes.focus = "deleted";
        f.manager.windowManger.forceMaximized = true;
        f.manager.windowManger.canOperate = writable;
        f.manager.initialFocusRecoveryPending = true;
        f.manager.initialFocusRecoverySource = "deleted";
        f.manager.initialFocusRecoveryAppIds = new Set(["B"]);
        f.manager.boxManager.boxSize = 1;
        f.manager.boxManager.getTopBox = vi.fn(() => box);
        f.manager.boxManager.getBox = vi.fn(() => box);
        f.manager.boxManager.setZIndex = vi.fn();
        f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

        f.manager.focusByAttributes(f.attributes.apps);
        await flush();

        expect(app.ensureSetup).toHaveBeenCalledTimes(1);
        expect(f.attributes.focus).toBe(writable ? "B" : "deleted");
        expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
    }
);

it("does not recover a stale initial focus after the room focus changes", async () => {
    const f = fixture();
    f.app("B");
    f.attributes.focus = "other-deleted";
    f.manager.windowManger.forceMaximized = true;
    f.manager.initialFocusRecoveryPending = true;
    f.manager.initialFocusRecoverySource = "deleted";
    f.manager.initialFocusRecoveryAppIds = new Set(["B"]);
    f.manager.boxManager.boxSize = 1;
    f.manager.boxManager.getTopBox = vi.fn(() => ({ id: "B", zIndex: 101 }));

    f.manager.focusByAttributes(f.attributes.apps);
    await flush();

    expect(f.attributes.focus).toBe("other-deleted");
    expect(f.manager.boxManager.focusBox).not.toHaveBeenCalled();
});

it.each([true, false])(
    "close handoff waits for destruction, then focuses the remaining Box; cached=%s",
    async cached => {
        const f = fixture();
        const closing = deferred();
        const setup = deferred();
        const previous = f.app("A");
        previous.isSetup = true;
        const next = f.app("B", setup.promise);
        next.isSetup = cached;
        if (cached) f.manager.runtimeCache.set("B", { state: "ready", lastUsed: 1 });
        f.attributes.focus = "A";
        f.manager._prevFocused = "A";
        f.manager.activeLazyAppId = "A";
        const boxes: Record<string, { zIndex: number }> = {
            A: { zIndex: 101 }, B: { zIndex: 100 },
        };
        f.manager.boxManager.getBox = vi.fn((id: string) => boxes[id]);
        f.manager.boxManager.getTopBox = vi.fn((exclude?: string) =>
            Object.entries(boxes).filter(([id]) => id !== exclude)
                .sort((a, b) => b[1].zIndex - a[1].zIndex)[0]?.[1]);
        f.manager.boxManager.setZIndex = vi.fn((id: string, zIndex: number) => {
            boxes[id].zIndex = zIndex;
        });
        f.manager.boxManager.boxIsFocus = vi.fn(() => false);
        f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

        const close = f.manager.captureAppClose("A");
        f.manager.trackAppClose("A", closing.promise);
        previous.isDestroyed = true;
        f.manager.notifyAppDestroyed("A");
        delete (f.attributes.apps as Record<string, unknown>).A;
        f.manager.appProxies.delete("A");
        f.manager.finishAppClose("A", close);
        await flush();
        expect(f.attributes.focus).toBe("A");
        expect(next.ensureSetup).not.toHaveBeenCalled();

        closing.resolve();
        await flush();
        if (!cached) {
            expect(next.ensureSetup).toHaveBeenCalledTimes(1);
            expect(f.attributes.focus).toBe("A");
            setup.resolve();
            await flush();
        } else {
            expect(next.ensureSetup).not.toHaveBeenCalled();
        }
        expect(f.attributes.focus).toBe("B");
        expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
        expect(boxes.B.zIndex).toBeGreaterThan(101);
    }
);

it("recovers the highest Box locally on a read-only client", async () => {
    const f = fixture();
    const lower = f.app("A");
    const app = f.app("B");
    const boxes = {
        A: { id: "A", zIndex: 100 },
        B: { id: "B", zIndex: 101 },
    };
    f.manager.windowManger.forceMaximized = true;
    f.manager.windowManger.canOperate = false;
    f.manager.initialFocusRecoveryPending = true;
    f.manager.initialFocusRecoveryAppIds = new Set(["A", "B"]);
    f.manager.boxManager.boxSize = 2;
    f.manager.boxManager.getTopBox = vi.fn(() => boxes.B);
    f.manager.boxManager.getBox = vi.fn((id: "A" | "B") => boxes[id]);
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    f.manager.focusByAttributes(f.attributes.apps); await flush();

    expect(f.attributes.focus).toBeUndefined();
    expect(app.ensureSetup).toHaveBeenCalledOnce();
    expect(lower.ensureSetup).not.toHaveBeenCalled();
    expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
});

it("keeps a read-only recovered Box focused after setup failure", async () => {
    const f = fixture();
    const app = f.app("B");
    app.ensureSetup = vi.fn().mockRejectedValue(new Error("setup failed"));
    const box = { id: "B", zIndex: 101 };
    f.manager.windowManger.forceMaximized = true;
    f.manager.windowManger.canOperate = false;
    f.manager.initialFocusRecoveryPending = true;
    f.manager.initialFocusRecoveryAppIds = new Set(["B"]);
    (f.attributes as any).focus = null;
    f.manager.boxManager.boxSize = 1;
    f.manager.boxManager.getTopBox = vi.fn(() => box);
    f.manager.boxManager.getBox = vi.fn(() => box);
    f.manager.boxManager.setZIndex = vi.fn();
    f.manager.boxManager.teleBoxManager = { makeBoxTop: vi.fn() };

    f.manager.focusByAttributes(f.attributes.apps); await flush();

    expect(f.attributes.focus).toBeNull();
    expect(app.isSetup).toBe(false);
    expect(f.manager.boxManager.focusBox).toHaveBeenCalledWith({ appId: "B" });
    f.manager.refreshLazyActivity(); await flush();
    expect(app.ensureSetup).toHaveBeenCalledTimes(1);
});

it("does not infer focus from top zIndex outside forceMaximized initialization", async () => {
    const f = fixture();
    const app = f.app("B");
    f.manager.initialFocusRecoveryPending = true;
    f.manager.initialFocusRecoveryAppIds = new Set(["B"]);
    f.manager.boxManager.boxSize = 1;
    f.manager.boxManager.getTopBox = vi.fn(() => ({ id: "B", zIndex: 101 }));

    f.manager.focusByAttributes(f.attributes.apps); await flush();

    expect(f.attributes.focus).toBeUndefined();
    expect(app.ensureSetup).not.toHaveBeenCalled();
});

it("the sole focus request yields a direct setup at its original 10s deadline", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise); const e = f.app("E");
    const setup = f.manager.enqueueAppSetup("A"); await flush();
    vi.advanceTimersByTime(6_000); f.focus("E"); await flush();
    vi.advanceTimersByTime(3_999); await flush(); expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await flush(); expect(e.ensureSetup).toHaveBeenCalledOnce();
    expect(f.manager.activeLazyAppId).toBe("E");
    a.resolve(); await setup; await flush(); expect(f.manager.activeLazyAppId).toBe("E");
});

it("reports each hung setup once while yielded physical work overlaps the latest setup", async () => {
    const f = fixture(); const aSetup = deferred(); const eSetup = deferred();
    const a = f.app("A", aSetup.promise); const e = f.app("E", eSetup.promise);
    f.focus("A"); await flush();
    expect(a.ensureSetup).toHaveBeenCalledOnce();
    f.focus("E"); await flush();

    vi.advanceTimersByTime(9_999); await flush();
    expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await flush();
    expect(e.ensureSetup).toHaveBeenCalledOnce();
    expect(f.manager.setupStartedAt.has("A")).toBe(true);
    expect(f.manager.setupStartedAt.has("E")).toBe(true);

    vi.advanceTimersByTime(20_000); await flush();
    const timeoutLogs = f.manager.windowManger.Logger.error.mock.calls
        .map(([message]: [string]) => message)
        .filter((message: string) => message.includes("app setup timeout"));
    expect(timeoutLogs.filter((message: string) => message.includes("appId: A"))).toHaveLength(1);
    expect(timeoutLogs.filter((message: string) => message.includes("appId: E"))).toHaveLength(1);

    eSetup.resolve(); await flush();
    expect(f.manager.activeLazyAppId).toBe("E");
    aSetup.resolve(); await flush();
    expect(f.manager.activeLazyAppId).toBe("E");
});

it("skips every queued old setup before yielding to the latest focus", async () => {
    const f = fixture(); const a = deferred();
    f.app("A", a.promise);
    const b = f.app("B"); const e = f.app("E");
    const running = f.manager.enqueueAppSetup("A"); await flush();
    const queued = f.manager.enqueueAppSetup("B").catch(() => undefined);
    expect(f.manager.setupTaskQueue.size).toBe(1);
    f.focus("E"); await queued; await flush();
    expect(f.manager.setupTaskQueue.size).toBe(0);

    vi.advanceTimersByTime(10_000); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(e.ensureSetup).toHaveBeenCalledOnce();
    a.resolve(); await running;
});

it("an added App waits on the same latest pending slot and is not set up after replacement", async () => {
    const f = fixture();
    const a = deferred();
    f.app("A", a.promise);
    const b = f.app("B");
    b.waitForSetup = vi.fn(() => new Promise<void>(() => undefined));
    const e = f.app("E");
    f.focus("A"); await flush();
    f.focus("B");
    const waiting = f.manager.waitForLazyAddedAppSetup("B", b);
    f.focus("E");
    await expect(waiting).rejects.toMatchObject({ reason: "superseded" });
    vi.advanceTimersByTime(10_000); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(e.ensureSetup).toHaveBeenCalledOnce();
    a.resolve(); await flush();
});

it("publishes only the final pending App scene after setup and focus", async () => {
    const f = fixture();
    const aSetup = deferred();
    const a = f.app("A", aSetup.promise);
    const b = f.app("B");
    f.focus("A"); await flush();
    f.focus("B"); await flush();
    expect(a.setScenePath).not.toHaveBeenCalled();
    expect(b.setScenePath).not.toHaveBeenCalled();

    aSetup.resolve(); await flush();
    expect(a.setScenePath).not.toHaveBeenCalled();
    expect(a.setViewFocusScenePath).not.toHaveBeenCalled();
    expect(b.setViewFocusScenePath).toHaveBeenCalledOnce();
    expect(b.setScenePath).toHaveBeenCalledOnce();
    expect(f.manager.activeLazyAppId).toBe("B");
});

it("publishes the scene of a warm App without setting it up again", async () => {
    const f = fixture();
    const b = f.app("B");
    b.isSetup = true;
    f.focus("B"); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(b.setViewFocusScenePath).toHaveBeenCalledOnce();
    expect(b.setScenePath).toHaveBeenCalledOnce();
});

it("does not focus a stale App if scene publication is superseded", async () => {
    const f = fixture();
    const b = f.app("B");
    const c = f.app("C");
    b.isSetup = true;
    b.setScenePath.mockImplementation(() => f.focus("C"));
    f.focus("B"); await flush();
    expect(f.manager.boxManager.focusBox).not.toHaveBeenCalledWith({ appId: "B" });
    expect(f.manager.activeLazyAppId).toBe("C");
    expect(c.setScenePath).toHaveBeenCalledOnce();
});

it("bounds an added App wait to the previous 10s plus its own 10s and logs each hung setup once", async () => {
    const f = fixture();
    const a = deferred(); const bSetup = deferred(); const bReady = deferred();
    f.app("A", a.promise);
    const b = f.app("B", bSetup.promise);
    b.waitForSetup = vi.fn(() => bReady.promise);
    f.focus("A"); await flush();
    f.focus("B");
    const waiting = f.manager.waitForLazyAddedAppSetup("B", b);
    const outcome = waiting.catch((error: unknown) => error);
    vi.advanceTimersByTime(9_999); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await flush();
    expect(b.ensureSetup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(9_999); await flush();
    const setupTimeouts = () => f.manager.windowManger.Logger.error.mock.calls
        .map(([message]: [string]) => message)
        .filter((message: string) => message.includes("app setup timeout"));
    expect(setupTimeouts().filter((message: string) => message.includes("appId: A"))).toHaveLength(1);
    expect(setupTimeouts().filter((message: string) => message.includes("appId: B"))).toHaveLength(0);
    vi.advanceTimersByTime(1); await flush();
    expect(await outcome).toBeInstanceOf(LazySetupWaitError);
    expect(setupTimeouts().filter((message: string) => message.includes("appId: B"))).toHaveLength(1);
    expect(f.manager.windowManger.Logger.error).toHaveBeenCalledWith(
        expect.stringContaining("lazy add setup wait timeout")
    );
    a.resolve(); bSetup.resolve(); bReady.resolve(); await flush();
});

it("direct setup completion wakes the sole pending target before the deadline", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise); const e = f.app("E");
    const setup = f.manager.enqueueAppSetup("A"); f.focus("E"); await flush();
    vi.advanceTimersByTime(2_000); a.resolve(); await setup; await flush();
    expect(e.ensureSetup).toHaveBeenCalledOnce();
    expect(f.manager.windowManger.Logger.warn).not.toHaveBeenCalled();
});

it("arbitrates a direct setup that starts after the focus intent was taken", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise); const e = f.app("E");
    f.focus("E"); // active intent, its async run has not enqueued E yet
    const setup = f.manager.enqueueAppSetup("A"); await flush();
    vi.advanceTimersByTime(9_999); await flush(); expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await flush(); expect(e.ensureSetup).toHaveBeenCalledOnce();
    a.resolve(); await setup;
});

it("mainView is a real latest target during minimize and does not setup skipped apps", async () => {
    const f = fixture(true); const a = deferred(); f.app("A", a.promise); const e = f.app("E");
    f.manager.boxManager.minimized = false;
    f.manager.boxManager.setMinimized = (min: boolean) => { f.manager.boxManager.minimized = min; };
    f.focus("A"); await flush(); f.focus("E");
    f.attributes.minimized = true; f.manager.onMinimized(true); f.manager.requestMainViewFocus();
    // Track completion independently from immediate Attribute blur.
    f.manager.activeLazyAppId = "A";
    await flush(); vi.advanceTimersByTime(9_999); await flush();
    expect(f.manager.activeLazyAppId).toBe("A");
    vi.advanceTimersByTime(1); await flush(); await f.manager.lazyFocusQueue;
    expect(f.manager.desiredLazyFocus).toMatchObject({ focused: undefined });
    expect(f.manager.activeLazyAppId).toBeUndefined();
    expect(e.ensureSetup).not.toHaveBeenCalled();
    expect(f.attributes.focus).toBeUndefined();
    a.resolve(); await flush(); expect(f.attributes.focus).toBeUndefined();
});

it("mainView completes immediately when direct setup finishes while hidden", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise);
    const setup = f.manager.enqueueAppSetup("A");
    f.focus("A"); await flush();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    f.focus(undefined); f.manager.activeLazyAppId = "A";
    a.resolve(); await setup; await flush();
    expect(f.manager.activeLazyAppId).toBeUndefined();
});

it("mainView does not collide with an app whose id is the string undefined", async () => {
    const f = fixture(); const a = deferred(); f.app("undefined", a.promise);
    f.focus("undefined"); await flush(); f.focus(undefined);
    vi.advanceTimersByTime(10_000); await flush(); await f.manager.lazyFocusQueue;
    expect(f.manager.setupTaskQueue.current).toBeUndefined();
    expect(f.manager.desiredLazyFocus.focused).toBeUndefined();
    a.resolve(); await flush();
});

it("a newer app replaces mainView pending but stays suspended until restore", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise); const e = f.app("E");
    f.focus("A"); await flush(); f.attributes.minimized = true;
    f.focus(undefined); f.focus("E");
    vi.advanceTimersByTime(12_000); await flush(); expect(e.ensureSetup).not.toHaveBeenCalled();
    f.attributes.minimized = false; f.manager.refreshLazyActivity(); await flush();
    expect(e.ensureSetup).toHaveBeenCalledOnce(); expect(f.manager.activeLazyAppId).toBe("E");
    a.resolve(); await flush();
});

it("logs conflicting historical boxesStatus once without changing it or unblocking setup", async () => {
    const f = fixture(); const e = f.app("E"); f.manager.useBoxesStatus = false;
    (f.attributes as any).boxesStatus = { E: "minimized" };
    f.focus("E"); f.manager.refreshLazyActivity(); await flush();
    vi.advanceTimersByTime(20_000); await flush();
    expect(e.ensureSetup).not.toHaveBeenCalled();
    expect(f.manager.windowManger.Logger.error).toHaveBeenCalledOnce();
    expect(f.manager.windowManger.Logger.error).toHaveBeenCalledWith(expect.stringContaining("appId: E"));
    expect((f.attributes as any).boxesStatus.E).toBe("minimized");
    // Only an external state change, not the diagnostic, can open the gate.
    (f.attributes as any).boxesStatus.E = "maximized"; f.manager.refreshLazyActivity(); await flush();
    expect(e.ensureSetup).toHaveBeenCalledOnce();
});

it("restores local box state before activity notification and awaits activation completion", async () => {
    const f = fixture(true); const a = f.app("A"); const release = deferred();
    a.isSetup = true; f.attributes.focus = "A"; f.manager._prevFocused = "A";
    f.manager.boxManager.minimized = true;
    f.manager.boxManager.setMinimized = vi.fn((min: boolean) => { f.manager.boxManager.minimized = min; });
    a.emitAppActivityEvent.mockImplementation(async () => {
        expect(f.manager.boxManager.minimized).toBe(false);
        await release.promise;
        return true;
    });
    f.manager.onMinimized(false);
    let done = false;
    const focusing = f.manager.requestFocusAndWait("A").then((result: boolean) => { done = true; return result; });
    await flush(); expect(done).toBe(false);
    release.resolve(); await flush(); await expect(focusing).resolves.toBe(true);
});

it("mainView request supersedes an uncommitted TeleBox intent even if Attribute focus was already undefined", async () => {
    const f = fixture(); const a = deferred(); const proxy = f.app("A", a.promise);
    f.manager.handleBoxFocus({ appId: "A", source: "telebox" }); await flush();
    expect(proxy.ensureSetup).toHaveBeenCalledOnce(); expect(f.attributes.focus).toBeUndefined();
    f.attributes.minimized = true; f.manager.requestMainViewFocus();
    expect(f.manager.desiredLazyFocus.focused).toBeUndefined();
    vi.advanceTimersByTime(10_000); await flush();
    await f.manager.lazyFocusQueue;
    a.resolve(); await flush(); expect(f.attributes.focus).toBeUndefined();
});

it("does not commit a TeleBox target removed during cache eviction", async () => {
    const f = fixture(); const b = f.app("B"); const eviction = deferred();
    f.manager.evictBeforeSetup = vi.fn(() => eviction.promise);
    const write = vi.spyOn(f.manager.windowManger, "safeSetAttributes");
    f.manager.handleBoxFocus({ appId: "B", source: "telebox" });
    await flush();
    expect(f.manager.evictBeforeSetup).toHaveBeenCalledWith("B");

    delete (f.attributes.apps as Record<string, unknown>).B;
    eviction.resolve(); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalledWith({ focus: "B" });
    expect(f.attributes.focus).toBeUndefined();
});

it("a new minimize during release prevents a stale successful focus commit", async () => {
    const f = fixture(); const a = f.app("A"); const release = deferred(); a.isSetup = true;
    a.emitAppActivityEvent.mockImplementation(async () => { await release.promise; return true; });
    const focusing = f.manager.requestFocusAndWait("A"); await flush();
    f.attributes.minimized = true; f.manager.refreshLazyActivity();
    release.resolve(); await flush(); await expect(focusing).resolves.toBe(false);
    expect(f.manager.boxManager.focusBox).not.toHaveBeenCalled();
});

it("uses one pending slot for synchronized, API and TeleBox requests", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise);
    const b = f.app("B"); const c = f.app("C"); const e = f.app("E");
    f.focus("A"); await flush();
    const api = f.manager.requestFocusAndWait("B");
    f.focus("C");
    f.manager.handleBoxFocus({ appId: "E", source: "telebox" });
    await expect(api).resolves.toBe(false); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled(); expect(c.ensureSetup).not.toHaveBeenCalled();
    expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000); await flush();
    expect(e.ensureSetup).toHaveBeenCalledOnce(); expect(f.manager.activeLazyAppId).toBe("E");
    expect(f.manager.settingUpApps.has("A")).toBe(true);
    a.resolve(); await flush(); expect(f.manager.activeLazyAppId).toBe("E");
    expect(f.manager.windowManger.Logger.warn).toHaveBeenCalledWith(expect.stringContaining("setup yielded"));
});

it("waits for the remaining age after minimizing, preserving synchronized pending", async () => {
    const f = fixture(); const a = deferred(); f.app("A", a.promise); const e = f.app("E");
    f.focus("A"); await flush();
    f.attributes.minimized = true; f.manager.refreshLazyActivity();
    f.focus("E"); await flush();
    vi.advanceTimersByTime(6_000); f.attributes.minimized = false; f.manager.refreshLazyActivity();
    await flush(); expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_999); await flush(); expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); await flush(); expect(e.ensureSetup).toHaveBeenCalledOnce();
    a.resolve(); await flush();
});

it("retains the latest focus while hidden even with an idle setup queue", async () => {
    const f = fixture(); const e = f.app("E");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    f.focus("E"); vi.advanceTimersByTime(12_000); await flush();
    expect(e.ensureSetup).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    f.manager.refreshLazyActivity(); await flush();
    expect(e.ensureSetup).toHaveBeenCalledOnce(); expect(f.manager.activeLazyAppId).toBe("E");
});

it("reattaches the original A setup after yielding A then focusing back", async () => {
    const f = fixture(); const a = deferred(); const proxy = f.app("A", a.promise); f.app("E");
    f.focus("A"); await flush(); f.focus("E");
    vi.advanceTimersByTime(10_000); await flush();
    f.focus("A"); await flush(); expect(proxy.ensureSetup).toHaveBeenCalledOnce();
    a.resolve(); await flush(); expect(f.manager.activeLazyAppId).toBe("A");
    expect(proxy.ensureSetup).toHaveBeenCalledOnce();
});

it("a focus event completing after a newer synchronized focus cannot commit the old app", async () => {
    const f = fixture(); const releasing = deferred(); const a = f.app("A"); const e = f.app("E");
    a.isSetup = true; e.isSetup = true;
    a.emitAppFocusEvent.mockImplementation((focused: boolean) => focused ? releasing.promise.then(() => true) : Promise.resolve(true));
    f.focus("A"); await flush(); f.focus("E"); releasing.resolve(); await flush();
    expect(f.manager.boxManager.focusBox).not.toHaveBeenCalledWith({ appId: "A" });
    expect(f.manager.activeLazyAppId).toBe("E");
});

it("same focus resumes after unminimize without a new Attribute focus event", async () => {
    const f = fixture(); const a = f.app("A"); f.focus("A"); await flush();
    f.attributes.minimized = true; f.manager.refreshLazyActivity(); await flush();
    f.attributes.minimized = false; f.manager.refreshLazyActivity(); await flush();
    expect(a.ensureSetup).toHaveBeenCalledOnce();
    expect(a.emitAppActivityEvent.mock.calls.length).toBeGreaterThan(2);
    expect(f.manager.activeLazyAppId).toBe("A");
});

it("does not lose A blur when intermediate intents are replaced during A release", async () => {
    const f = fixture(); const releasing = deferred(); const a = f.app("A");
    a.isSetup = true;
    a.emitAppFocusEvent.mockImplementation((focused: boolean) => focused ? releasing.promise.then(() => true) : Promise.resolve(true));
    const b = f.app("B"); f.app("C"); f.app("E");
    f.focus("A"); await flush();
    f.focus("B"); f.focus("C"); f.focus("E"); await flush();
    expect(a.emitAppFocusEvent).toHaveBeenCalledWith(false);
    expect(b.ensureSetup).not.toHaveBeenCalled();
    releasing.resolve(); await flush();
    expect(f.manager.activeLazyAppId).toBe("E");
});

it("waits for a started minimized teardown before rebuilding the same target", async () => {
    const f = fixture(); const a = f.app("A");
    a.kind = "Presentation";
    const teardown = deferred();
    a.teardown.mockImplementation(async () => { await teardown.promise; a.isSetup = false; });
    f.focus("A"); await flush();
    f.attributes.minimized = true; f.manager.minimizedRevision = 1;
    f.manager.refreshLazyActivity();
    f.manager.minimizedCleanup = f.manager.teardownAllRuntimeCaches(); await flush();
    expect(a.teardown).toHaveBeenCalledOnce();
    f.attributes.minimized = false; f.manager.minimizedRevision = 2;
    f.manager.refreshLazyActivity(); await flush();
    expect(a.ensureSetup).toHaveBeenCalledOnce();
    teardown.resolve(); await flush();
    expect(a.ensureSetup).toHaveBeenCalledTimes(2);
    expect(f.manager.activeLazyAppId).toBe("A");
    expect(f.manager.runtimeCache.get("A").state).toBe("ready");
});

it("explicit synchronized no-focus while minimized replaces pending and never restores old A", async () => {
    const f = fixture(); f.attributes.minimized = true; const a = f.app("A");
    f.focus("A"); f.focus(undefined); await flush();
    f.attributes.minimized = false; f.manager.refreshLazyActivity(); await flush();
    expect(a.ensureSetup).not.toHaveBeenCalled(); expect(f.attributes.focus).toBeUndefined();
});

it("late failed setup cannot delete the cache of a recreated same-id proxy", async () => {
    const f = fixture();
    let reject!: (error: Error) => void;
    const original = f.app("A", new Promise<void>((_, fail) => { reject = fail; }));
    const setup = f.manager.enqueueAppSetup("A"); await flush();
    original.isDestroyed = true; f.manager.notifyAppDestroyed("A");
    const replacement = f.app("A"); replacement.isSetup = true;
    f.manager.touchRuntime("A");
    reject(new Error("old attempt failed"));
    await expect(setup).rejects.toThrow("old attempt failed");
    expect(f.manager.runtimeCache.get("A").state).toBe("ready");
    expect(f.manager.appProxies.get("A")).toBe(replacement);
});

it("releases a destroyed app's physical setup blocker before setting up the next addApp", async () => {
    const f = fixture();
    const running = deferred();
    const old = f.app("A", running.promise);
    const next = f.app("B");
    const setup = f.manager.enqueueAppSetup("A");
    await flush();
    expect(old.ensureSetup).toHaveBeenCalledOnce();

    old.isDestroyed = true;
    f.manager.appProxies.delete("A");
    delete (f.attributes.apps as Record<string, unknown>).A;
    f.manager.notifyAppDestroyed("A");
    f.manager.beforeAddApp = vi.fn().mockResolvedValue({ appId: "B", needFocus: true });
    f.manager.baseInsertApp = vi.fn().mockResolvedValue({ id: "B" });
    f.manager.afterAddApp = vi.fn();
    expect(await f.manager.addApp({ kind: "Slide" }, false)).toBe("B");
    expect(f.manager.setupStartedAt.has("A")).toBe(true);
    expect(next.ensureSetup).not.toHaveBeenCalled();

    running.resolve();
    await setup;
    await flush();
    expect(f.manager.setupStartedAt.has("A")).toBe(false);
    expect(next.ensureSetup).toHaveBeenCalledOnce();
    expect(f.attributes.focus).toBe("B");
});

it("destroying an unstarted target removes only its pending setup", async () => {
    const f = fixture(); const a = deferred();
    f.app("A", a.promise);
    const b = f.app("B"); const e = f.app("E");
    b.waitForSetup = vi.fn(() => new Promise<void>(() => undefined));
    f.focus("A"); await flush();
    f.focus("B");
    const waiting = f.manager.waitForLazyAddedAppSetup("B", b);
    f.manager.notifyAppDestroyed("B");
    await expect(waiting).rejects.toMatchObject({ reason: "destroyed" });
    expect(f.manager.desiredLazyFocus).toBeUndefined();
    f.focus("E");
    vi.advanceTimersByTime(10_000); await flush();
    expect(b.ensureSetup).not.toHaveBeenCalled();
    expect(e.ensureSetup).toHaveBeenCalledOnce();
    a.resolve(); await flush();
});
