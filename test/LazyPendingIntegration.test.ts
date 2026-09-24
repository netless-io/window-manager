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
        get focus() { return attributes.focus; },
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
            ensureSetup: vi.fn(async () => { await setup; proxy.isSetup = true; }) };
        manager.appProxies.set(id, proxy);
        return proxy;
    }
    return { manager, attributes, focus, app };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
