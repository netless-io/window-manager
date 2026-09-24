import { describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk");

import { AppManager } from "../src/AppManager";
import { SetupQueue } from "../src/Utils/SetupQueue";

const createProxy = (kind = "Slide") => {
    const proxy = {
        kind,
        isSetup: false,
        isDestroyed: false,
        canTeardown: true,
        ensureSetup: vi.fn(async () => {
            proxy.isSetup = true;
        }),
        teardown: vi.fn(async () => {
            proxy.isSetup = false;
        }),
        emitAppFocusEvent: vi.fn(async (_focused: boolean) => true),
    };
    return proxy;
};

const createManager = (capacity = 1) => {
    const manager = Object.create(AppManager.prototype) as any;
    Object.assign(manager, {
        windowManger: {
            lazySetupInMaximizedMode: true,
            maxCachedAppsInMaximizedMode: capacity,
            attributes: { apps: {}, minimized: false },
            Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        store: { focus: undefined },
        appProxies: new Map(),
        runtimeCache: new Map(),
        settingUpApps: new Map(),
        setupTaskQueue: new SetupQueue(),
        lazyFocusQueue: Promise.resolve(),
        lazyFocusGeneration: 0,
        lruClock: 0,
        destroyed: false,
        boxManager: { getBox: vi.fn(), focusBox: vi.fn() },
    });
    return manager;
};

const focus = async (manager: any, id: string) => {
    const previous = manager.activeLazyAppId;
    manager.store.focus = id;
    manager.queueLazyFocusTransition(previous, id, ++manager.lazyFocusGeneration);
    await manager.lazyFocusQueue;
};

describe("lazy Slide runtime retention", () => {
    it("sets up six Slides only once across repeated switches with cache=5", async () => {
        const manager = createManager(5);
        const slides = Array.from({ length: 6 }, () => createProxy());
        slides.forEach((proxy, index) => manager.appProxies.set(String(index), proxy));

        for (let round = 0; round < 3; round += 1) {
            for (let index = 0; index < slides.length; index += 1) {
                await focus(manager, String(index));
                expect(manager.activeLazyAppId).toBe(String(index));
                expect(manager.runtimeCache.size).toBeLessThanOrEqual(5);
                expect(manager.runtimeCache.get(String(index))?.state).toBe("ready");
            }
        }

        for (const slide of slides) {
            expect(slide.ensureSetup).toHaveBeenCalledTimes(1);
            expect(slide.teardown).not.toHaveBeenCalled();
            expect(slide.isSetup).toBe(true);
            expect(slide.emitAppFocusEvent).toHaveBeenCalledWith(false);
            expect(slide.emitAppFocusEvent).toHaveBeenCalledWith(true);
        }
        expect(manager.settingUpApps.size).toBe(0);
    });

    it("awaits the old Slide blur before restoring a Slide outside cache", async () => {
        const manager = createManager();
        const first = createProxy();
        const second = createProxy();
        manager.appProxies = new Map([
            ["first", first],
            ["second", second],
        ]);
        await focus(manager, "first");
        await focus(manager, "second");
        expect(manager.runtimeCache.has("first")).toBe(false);
        first.emitAppFocusEvent.mockClear();
        let finishBlur!: () => void;
        const blurStarted = new Promise<void>(started => {
            second.emitAppFocusEvent.mockImplementationOnce(
                () => new Promise<void>(resolve => {
                    finishBlur = resolve;
                    started();
                })
            );
        });
        const transition = focus(manager, "first");
        await blurStarted;
        expect(first.emitAppFocusEvent).not.toHaveBeenCalled();
        expect(manager.runtimeCache.has("first")).toBe(false);
        finishBlur();
        await transition;

        expect(first.emitAppFocusEvent).toHaveBeenCalledWith(true);
        expect(first.ensureSetup).toHaveBeenCalledTimes(1);
        expect(second.teardown).not.toHaveBeenCalled();
        expect(Array.from(manager.runtimeCache.keys())).toEqual(["first"]);
    });

    it.each(["Presentation", "MediaPlayer"])("still tears down evicted %s", async kind => {
        const manager = createManager();
        const other = createProxy(kind);
        const slide = createProxy();
        manager.appProxies = new Map([
            ["other", other],
            ["slide", slide],
        ]);
        await focus(manager, "other");
        await focus(manager, "slide");
        expect(other.teardown).toHaveBeenCalledTimes(1);
        expect(other.isSetup).toBe(false);
        await focus(manager, "other");
        expect(other.ensureSetup).toHaveBeenCalledTimes(2);
        expect(slide.teardown).not.toHaveBeenCalled();
    });

    it("keeps Slides initialized when minimized, including those outside cache", async () => {
        const manager = createManager();
        const first = createProxy();
        const second = createProxy();
        manager.appProxies = new Map([
            ["first", first],
            ["second", second],
        ]);
        await focus(manager, "first");
        await focus(manager, "second");
        manager.attributes.minimized = true;
        await manager.teardownAllRuntimeCaches();
        expect(manager.runtimeCache.size).toBe(0);
        for (const proxy of [first, second]) {
            expect(proxy.isSetup).toBe(true);
            expect(proxy.teardown).not.toHaveBeenCalled();
        }
        manager.attributes.minimized = false;
        await focus(manager, "first");
        expect(first.ensureSetup).toHaveBeenCalledTimes(1);
        expect(first.emitAppFocusEvent).toHaveBeenLastCalledWith(true);
    });

    it("retains a Slide whose setup completes after minimizing", async () => {
        const manager = createManager();
        const slide = createProxy();
        manager.appProxies.set("slide", slide);
        let finishSetup!: () => void;
        const setupStarted = new Promise<void>(started => {
            slide.ensureSetup.mockImplementationOnce(async () => {
                await new Promise<void>(resolve => {
                    finishSetup = resolve;
                    started();
                });
                slide.isSetup = true;
            });
        });
        const pending = manager.enqueueAppSetup("slide");
        await setupStarted;
        manager.attributes.minimized = true;
        finishSetup();
        await pending;
        await manager.setupTaskQueue.push("drain", () => 0, async () => undefined);
        expect(manager.runtimeCache.size).toBe(0);
        expect(slide.isSetup).toBe(true);
        expect(slide.teardown).not.toHaveBeenCalled();
    });

    it("retries failed first setup instead of treating it as a retained runtime", async () => {
        const manager = createManager();
        const slide = createProxy();
        manager.appProxies.set("slide", slide);
        slide.ensureSetup.mockRejectedValueOnce(new Error("first render failed"));
        await expect(manager.enqueueAppSetup("slide")).rejects.toThrow("first render failed");
        expect(slide.isSetup).toBe(false);
        expect(manager.runtimeCache.has("slide")).toBe(false);
        await focus(manager, "slide");
        expect(slide.ensureSetup).toHaveBeenCalledTimes(2);
        expect(slide.isSetup).toBe(true);
    });

    it("sets up a replacement proxy after destruction/reconnection", async () => {
        const manager = createManager();
        const original = createProxy();
        manager.appProxies.set("slide", original);
        await focus(manager, "slide");
        manager.notifyAppDestroyed("slide");
        const replacement = createProxy();
        manager.appProxies.set("slide", replacement);
        await focus(manager, "slide");
        expect(replacement.ensureSetup).toHaveBeenCalledTimes(1);
    });

    it("does not run lazy eviction when lazy mode is disabled", async () => {
        const manager = createManager();
        const slide = createProxy();
        manager.appProxies.set("slide", slide);
        await focus(manager, "slide");
        manager.windowManger.lazySetupInMaximizedMode = false;
        await manager.evictBeforeSetup("other");
        await manager.evictAfterFocusCommit("other");
        expect(manager.runtimeCache.has("slide")).toBe(true);
        expect(slide.teardown).not.toHaveBeenCalled();
    });
});
