import Emittery from "emittery";
import { beforeAll, describe, expect, it, vi } from "vitest";

let WindowManager: typeof import("../src")["WindowManager"];
let UnifiedPageControlTracker: typeof import("../src/UnifiedPageControl")["UnifiedPageControlTracker"];
let executeAppPageCommand: typeof import("../src/UnifiedPageControl")["executeAppPageCommand"];

beforeAll(async () => {
    (globalThis as any).CanvasRenderingContext2D = class CanvasRenderingContext2D {};
    WindowManager = (await import("../src")).WindowManager;
    const unifiedPageControl = await import("../src/UnifiedPageControl");
    UnifiedPageControlTracker = unifiedPageControl.UnifiedPageControlTracker;
    executeAppPageCommand = unifiedPageControl.executeAppPageCommand;
});

const createManager = () => {
    const manager = Object.create(WindowManager.prototype) as any;
    manager.emitter = new Emittery();
    manager._unifiedPageControl = new UnifiedPageControlTracker();
    manager.queryAll = () => [];
    manager.queryOne = () => undefined;
    manager.onMainViewScenePathChangeHandler = () => undefined;
    return manager;
};

const registerAppKind = (kind: string) => {
    const registered = (WindowManager as any).registered;
    const previous = registered.get(kind);
    registered.set(kind, {});
    return () => {
        if (previous) registered.set(kind, previous);
        else registered.delete(kind);
    };
};

const flushEvents = () => new Promise(resolve => setTimeout(resolve, 0));

describe("unified page control", () => {
    it("uses target as the appId and falls back from focused app to mainView", () => {
        const manager = createManager();
        Object.defineProperty(manager, "focused", {
            configurable: true,
            value: "Slide-focused",
        });

        expect(manager.resolveUnifiedPageTarget({ target: "Slide-explicit" })).toBe(
            "Slide-explicit"
        );
        expect(manager.resolveUnifiedPageTarget({})).toBe("Slide-focused");
        Object.defineProperty(manager, "focused", { configurable: true, value: undefined });
        expect(manager.resolveUnifiedPageTarget({})).toBe("mainView");
        expect(manager.resolveUnifiedPageTarget({ target: "" })).toBeUndefined();
        expect(manager.resolveUnifiedPageTarget({ appId: "Slide-legacy" } as any)).toBeUndefined();
    });

    it("rejects command-only fields from getPageState", async () => {
        const manager = createManager();

        await expect(manager.getPageState({ page: 1 } as any)).rejects.toThrow(
            "invalid page state options"
        );
    });

    it("observes mainView state without dispatching a command first", async () => {
        const manager = createManager();
        const listener = vi.fn();
        manager.ensureUnifiedPageStateListeners();
        manager.emitter.on("unifiedPageStateChange", listener);
        manager.appManager = {
            mainViewProxy: { view: { focusSceneIndex: 1, focusScenePath: "/2" } },
            sceneState: { scenes: [{ name: "1" }, { name: "2" }, { name: "3" }] },
        };

        await manager.emitter.emit("pageStateChange", { index: 1, length: 3 });

        expect(listener).toHaveBeenCalledWith({
            target: "mainView",
            page: 2,
            pageCount: 3,
            status: "success",
            mainView: 2,
        });
    });

    it("reads live mainView state without suppressing the next source event", async () => {
        const manager = createManager();
        const listener = vi.fn();
        manager.appManager = {
            mainViewProxy: { view: { focusSceneIndex: 1, focusScenePath: "/2" } },
            sceneState: { scenes: [{ name: "1" }, { name: "2" }] },
        };
        manager._pageState = { toObject: () => ({ index: 1, length: 2 }) };
        manager.ensureUnifiedPageStateListeners();
        manager.emitter.on("unifiedPageStateChange", listener);

        await expect(manager.getPageState({ target: "mainView" })).resolves.toEqual({
            target: "mainView",
            page: 2,
            pageCount: 2,
        });
        await manager.emitter.emit("pageStateChange", { index: 1, length: 2 });

        expect(listener).toHaveBeenCalledOnce();
    });

    it("rejects a mainView jump to the current page", async () => {
        const manager = createManager();
        manager.appManager = {
            mainViewProxy: { view: { focusSceneIndex: 0, focusScenePath: "/1" } },
            sceneState: { scenes: [{ name: "1" }, { name: "2" }] },
        };
        manager._pageState = { toObject: () => ({ index: 0, length: 2 }) };
        Object.defineProperty(manager, "canOperate", { value: true });
        manager.jumpPage = vi.fn();

        await expect(
            manager.dispatchPageEvent("jumpToPage", { target: "mainView", page: 1 })
        ).resolves.toBe(false);
        expect(manager.jumpPage).not.toHaveBeenCalled();
    });

    it("accepts a mainView command before its asynchronous page change completes", async () => {
        const manager = createManager();
        let resolveCommand!: (value: boolean) => void;
        manager.appManager = {
            mainViewProxy: { view: { focusSceneIndex: 0, focusScenePath: "/1" } },
            sceneState: { scenes: [{ name: "1" }, { name: "2" }] },
        };
        manager._pageState = { toObject: () => ({ index: 0, length: 2 }) };
        Object.defineProperty(manager, "canOperate", { value: true });
        manager.nextPage = vi.fn(
            () => new Promise<boolean>(resolve => (resolveCommand = resolve))
        );

        await expect(
            manager.dispatchPageEvent("nextPage", { target: "mainView" })
        ).resolves.toBe(true);
        expect(manager.nextPage).toHaveBeenCalledOnce();
        resolveCommand(true);
    });

    it("validates mainView boundaries, writability, and 1-based jump pages", async () => {
        const firstPage = createManager();
        firstPage.appManager = {
            mainViewProxy: { view: { focusSceneIndex: 0, focusScenePath: "/1" } },
            sceneState: { scenes: [{ name: "1" }, { name: "2" }, { name: "3" }] },
        };
        firstPage._pageState = { toObject: () => ({ index: 0, length: 3 }) };
        Object.defineProperty(firstPage, "canOperate", { value: true });
        firstPage.prevPage = vi.fn();
        firstPage.jumpPage = vi.fn(() => Promise.resolve(true));

        await expect(
            firstPage.dispatchPageEvent("prevPage", { target: "mainView" })
        ).resolves.toBe(false);
        expect(firstPage.prevPage).not.toHaveBeenCalled();
        await expect(
            firstPage.dispatchPageEvent("jumpToPage", { target: "mainView", page: 3 })
        ).resolves.toBe(true);
        expect(firstPage.jumpPage).toHaveBeenCalledWith(2);

        const readonly = createManager();
        readonly.appManager = firstPage.appManager;
        readonly._pageState = firstPage._pageState;
        Object.defineProperty(readonly, "canOperate", { value: false });
        readonly.nextPage = vi.fn();
        await expect(
            readonly.dispatchPageEvent("nextPage", { target: "mainView" })
        ).resolves.toBe(false);
        expect(readonly.nextPage).not.toHaveBeenCalled();
    });

    it("reports a mainView pageCount change", async () => {
        const manager = createManager();
        const listener = vi.fn();
        manager.appManager = {
            mainViewProxy: { view: { focusSceneIndex: 0, focusScenePath: "/1" } },
            sceneState: { scenes: [{ name: "1" }, { name: "2" }] },
        };
        manager.ensureUnifiedPageStateListeners();
        manager.emitter.on("unifiedPageStateChange", listener);

        await manager.emitter.emit("pageStateChange", { index: 0, length: 1 });
        await manager.emitter.emit("pageStateChange", { index: 0, length: 2 });

        expect(listener).toHaveBeenLastCalledWith({
            target: "mainView",
            page: 1,
            pageCount: 2,
            status: "success",
            mainView: 1,
        });
    });

    it("keeps mainView addPage append and after-current semantics", async () => {
        const manager = createManager();
        const putScenes = vi.fn();
        Object.defineProperty(manager, "displayer", { value: { putScenes } });
        manager.appManager = {};
        Object.defineProperty(manager, "mainViewSceneIndex", { value: 1 });

        await manager.addPage();
        await manager.addPage({ after: true, scene: { name: "inserted" } });

        expect(putScenes).toHaveBeenNthCalledWith(1, "/", [{}]);
        expect(putScenes).toHaveBeenNthCalledWith(2, "/", [{ name: "inserted" }], 2);
    });

    it("installs the Slide render listener after delayed app setup", async () => {
        const manager = createManager();
        const slide = { on: vi.fn(), off: vi.fn() };
        const app: any = {
            id: "Slide-delayed",
            kind: "Slide",
            appEmitter: new Emittery(),
            appResult: undefined,
        };
        manager.queryOne = () => app;
        manager.ensureUnifiedPageStateListeners();
        manager.ensureUnifiedAppObserver(app.id, "Slide");

        app.appResult = { slide: () => slide };
        await manager.emitter.emit("onAppSetup", app.id);

        expect(slide.on).toHaveBeenCalledWith("renderEnd", expect.any(Function));
        expect(slide.on).toHaveBeenCalledTimes(1);
    });

    it("reinstalls the Slide observer after reconnect rebuilds AppProxy", async () => {
        const manager = createManager();
        const appId = "Slide-reconnected";
        const oldSlide = { on: vi.fn(), off: vi.fn() };
        let app: any = {
            id: appId,
            kind: "Slide",
            appEmitter: new Emittery(),
            appResult: { slide: () => oldSlide },
        };
        manager.queryOne = () => app;
        manager.ensureUnifiedPageStateListeners();
        manager.ensureUnifiedAppObserver(appId, "Slide");

        await app.appEmitter.emit("destroy", {});
        const newSlide = { on: vi.fn(), off: vi.fn() };
        app = {
            id: appId,
            kind: "Slide",
            appEmitter: new Emittery(),
            appResult: { slide: () => newSlide },
        };
        await manager.emitter.emit("onAppSetup", appId);

        expect(oldSlide.off).toHaveBeenCalledWith("renderEnd", expect.any(Function));
        expect(newSlide.on).toHaveBeenCalledWith("renderEnd", expect.any(Function));
    });

    it("reports renderEnd mismatch and later scenePath agreement", async () => {
        const manager = createManager();
        const listener = vi.fn();
        let renderEnd!: (page: number) => void;
        const app: any = {
            id: "Slide-render-first",
            kind: "Slide",
            appEmitter: new Emittery(),
            view: { focusSceneIndex: 0, focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [2, 3],
                slide: () => ({
                    on: (event: string, callback: (page: number) => void) => {
                        if (event === "renderEnd") renderEnd = callback;
                    },
                    off: vi.fn(),
                }),
            },
        };
        manager.queryOne = () => app;
        manager.ensureUnifiedPageStateListeners();
        manager.ensureUnifiedAppObserver(app.id, "Slide");
        manager.emitter.on("unifiedPageStateChange", listener);

        renderEnd(2);
        await flushEvents();
        expect(listener).toHaveBeenLastCalledWith({
            target: "Slide",
            appId: app.id,
            page: 2,
            pageCount: 3,
            status: "pending",
            view: 1,
            slide: 2,
        });

        app.view.focusSceneIndex = 1;
        app.view.focusScenePath = "/Slide/2";
        await manager.emitter.emit("onAppScenePathChange", { appId: app.id, view: app.view });
        await flushEvents();

        expect(listener).toHaveBeenLastCalledWith({
            target: "Slide",
            appId: app.id,
            page: 2,
            pageCount: 3,
            status: "success",
            view: 2,
            slide: 2,
        });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("reports scenePath mismatch and later renderEnd agreement", async () => {
        const manager = createManager();
        const listener = vi.fn();
        let renderEnd!: (page: number) => void;
        const slide = {
            isLoading: false,
            slideState: { currentSlideIndex: 1 },
            on: (event: string, callback: (page: number) => void) => {
                if (event === "renderEnd") renderEnd = callback;
            },
            off: vi.fn(),
        };
        const app: any = {
            id: "Slide-scene-first",
            kind: "Slide",
            appEmitter: new Emittery(),
            view: { focusSceneIndex: 1, focusScenePath: "/Slide/2" },
            appResult: {
                position: () => [2, 3],
                controller: () => ({ ready: true }),
                slide: () => slide,
            },
        };
        manager.queryOne = () => app;
        manager.ensureUnifiedPageStateListeners();
        manager.ensureUnifiedAppObserver(app.id, "Slide");
        manager.emitter.on("unifiedPageStateChange", listener);

        await manager.emitter.emit("onAppScenePathChange", { appId: app.id, view: app.view });
        await flushEvents();
        expect(listener).toHaveBeenLastCalledWith({
            target: "Slide",
            appId: app.id,
            page: 1,
            pageCount: 3,
            status: "pending",
            view: 2,
            slide: 1,
        });

        renderEnd(2);
        await flushEvents();
        expect(listener).toHaveBeenLastCalledWith({
            target: "Slide",
            appId: app.id,
            page: 2,
            pageCount: 3,
            status: "success",
            view: 2,
            slide: 2,
        });
    });

    it("initializes Slide render state when a late-ready scenePath event arrives", async () => {
        const manager = createManager();
        const listener = vi.fn();
        let ready = false;
        const slide = {
            isLoading: true,
            slideState: { currentSlideIndex: 1 },
            on: vi.fn(),
            off: vi.fn(),
        };
        const app: any = {
            id: "Slide-late-ready",
            kind: "Slide",
            appEmitter: new Emittery(),
            view: { focusSceneIndex: 0, focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [1, 2],
                controller: () => ({ ready }),
                slide: () => slide,
            },
        };
        manager.queryOne = () => app;
        manager.ensureUnifiedPageStateListeners();
        manager.ensureUnifiedAppObserver(app.id, "Slide");
        manager.emitter.on("unifiedPageStateChange", listener);

        await manager.emitter.emit("onAppScenePathChange", { appId: app.id, view: app.view });
        await flushEvents();
        expect(listener).not.toHaveBeenCalled();

        ready = true;
        slide.isLoading = false;
        await manager.emitter.emit("onAppScenePathChange", { appId: app.id, view: app.view });
        await flushEvents();
        expect(listener).toHaveBeenCalledWith({
            target: "Slide",
            appId: app.id,
            page: 1,
            pageCount: 2,
            status: "success",
            view: 1,
            slide: 1,
        });
    });

    it("reads live Slide position even when rendering is not confirmed", async () => {
        const manager = createManager();
        const app: any = {
            id: "Slide-unconfirmed",
            kind: "Slide",
            appEmitter: new Emittery(),
            view: { focusSceneIndex: 0, focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [2, 3],
                controller: () => ({ ready: false }),
                slide: () => ({ isLoading: true, on: vi.fn(), off: vi.fn() }),
            },
        };
        manager.queryOne = () => app;

        await expect(manager.getPageState({ target: app.id })).resolves.toEqual({
            target: "Slide",
            appId: app.id,
            page: 2,
            pageCount: 3,
        });
    });

    it("rejects Slide step commands at deck boundaries", async () => {
        const restore = registerAppKind("Slide");
        try {
            for (const scenario of [
                { event: "prevStep" as const, page: 1, method: "hasPrevStep" },
                { event: "nextStep" as const, page: 2, method: "hasNextStep" },
            ]) {
                const manager = createManager();
                const command = vi.fn(() => true);
                const hasStep = vi.fn(() => false);
                const slide: any = {
                    isLoading: false,
                    isAnimating: false,
                    slideState: { currentSlideIndex: scenario.page },
                    on: vi.fn(),
                    off: vi.fn(),
                    [scenario.method]: hasStep,
                };
                const app: any = {
                    id: `Slide-boundary-${scenario.event}`,
                    kind: "Slide",
                    appEmitter: new Emittery(),
                    box: {},
                    view: { focusScenePath: `/Slide/${scenario.page}` },
                    appResult: {
                        position: () => [scenario.page, 2],
                        controller: () => ({ ready: true }),
                        slide: () => slide,
                        [scenario.event]: command,
                    },
                };
                manager.queryOne = () => app;
                Object.defineProperty(manager, "canOperate", { value: true });

                await expect(
                    manager.dispatchPageEvent(scenario.event, { target: app.id })
                ).resolves.toBe(false);
                expect(hasStep).toHaveBeenCalledOnce();
                expect(command).not.toHaveBeenCalled();
            }
        } finally {
            restore();
        }
    });

    it("accepts an in-page Slide step without creating command state", async () => {
        const restore = registerAppKind("Slide");
        const manager = createManager();
        const nextStep = vi.fn(() => true);
        const slide = {
            isLoading: false,
            isAnimating: false,
            slideState: { currentSlideIndex: 1 },
            hasNextStep: () => true,
            on: vi.fn(),
            off: vi.fn(),
        };
        const app: any = {
            id: "Slide-step",
            kind: "Slide",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [1, 2],
                controller: () => ({ ready: true }),
                slide: () => slide,
                nextStep,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("nextStep", { target: app.id })
            ).resolves.toBe(true);
            expect(nextStep).toHaveBeenCalledOnce();
            expect(slide.on).toHaveBeenCalledTimes(1);
            expect(slide.on).toHaveBeenCalledWith("renderEnd", expect.any(Function));
        } finally {
            restore();
        }
    });

    it("passes a 1-based jump page to Slide", async () => {
        const restore = registerAppKind("Slide");
        const manager = createManager();
        const jumpToPage = vi.fn(() => true);
        const app: any = {
            id: "custom-slide-id",
            kind: "Slide",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [1, 3],
                controller: () => ({ ready: true }),
                slide: () => ({
                    isLoading: false,
                    isAnimating: false,
                    slideState: { currentSlideIndex: 1 },
                    on: vi.fn(),
                    off: vi.fn(),
                }),
                jumpToPage,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("jumpToPage", { target: app.id, page: 3 })
            ).resolves.toBe(true);
            expect(jumpToPage).toHaveBeenCalledWith(3);
        } finally {
            restore();
        }
    });

    it("routes an omitted target to the focused Slide and rejects an unknown target", async () => {
        const restore = registerAppKind("Slide");
        const manager = createManager();
        const nextPage = vi.fn(() => true);
        const app: any = {
            id: "focused-slide",
            kind: "Slide",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [1, 2],
                controller: () => ({ ready: true }),
                slide: () => ({
                    isLoading: false,
                    isAnimating: false,
                    slideState: { currentSlideIndex: 1 },
                    on: vi.fn(),
                    off: vi.fn(),
                }),
                nextPage,
            },
        };
        Object.defineProperty(manager, "focused", { value: app.id });
        manager.queryOne = (appId: string) => (appId === app.id ? app : undefined);
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(manager.dispatchPageEvent("nextPage")).resolves.toBe(true);
            expect(nextPage).toHaveBeenCalledOnce();
            await expect(
                manager.dispatchPageEvent("nextPage", { target: "missing-app" })
            ).resolves.toBe(false);
            expect(nextPage).toHaveBeenCalledOnce();
        } finally {
            restore();
        }
    });

    it("supports Slide page commands and rejects an app before setup", async () => {
        const restore = registerAppKind("Slide");
        const manager = createManager();
        const prevPage = vi.fn(() => true);
        const nextPage = vi.fn(() => true);
        const app: any = {
            id: "Slide-pages",
            kind: "Slide",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Slide/2" },
            appResult: {
                position: () => [2, 3],
                controller: () => ({ ready: true }),
                slide: () => ({
                    isLoading: false,
                    isAnimating: false,
                    slideState: { currentSlideIndex: 2 },
                    on: vi.fn(),
                    off: vi.fn(),
                }),
                prevPage,
                nextPage,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("prevPage", { target: app.id })
            ).resolves.toBe(true);
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(true);
            expect(prevPage).toHaveBeenCalledOnce();
            expect(nextPage).toHaveBeenCalledOnce();

            app.appResult = undefined;
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(false);
            expect(nextPage).toHaveBeenCalledOnce();
        } finally {
            restore();
        }
    });

    it("does not infer a supported App kind from the appId prefix", async () => {
        const restore = registerAppKind("Slide");
        const manager = createManager();
        const nextPage = vi.fn(() => true);
        const app: any = {
            id: "Slide-not-a-slide",
            kind: "MediaPlayer",
            appEmitter: new Emittery(),
            box: {},
            appResult: { nextPage },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(false);
            await expect(manager.getPageState({ target: app.id })).rejects.toThrow(
                "page state unavailable"
            );
            expect(nextPage).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    it("uses Presentation controller state for query and callback", async () => {
        const manager = createManager();
        const listener = vi.fn();
        let controllerState = { index: 1, length: 3 };
        let scenePath = "/Presentation/2";
        const app: any = {
            id: "Presentation-state",
            kind: "Presentation",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: scenePath },
            getFullScenePath: () => scenePath,
            appResult: { pageState: () => controllerState },
        };
        manager.queryOne = () => app;
        manager.emitter.on("unifiedPageStateChange", listener);
        manager.ensureUnifiedAppObserver(app.id, "Presentation");

        await expect(manager.getPageState({ target: app.id })).resolves.toEqual({
            target: "Presentation",
            appId: app.id,
            page: 2,
            pageCount: 3,
        });

        controllerState = { index: 2, length: 3 };
        scenePath = "/Presentation/3";
        app.view.focusScenePath = scenePath;
        await app.appEmitter.emit("pageStateChange", { index: 0, length: 1 });

        expect(listener).toHaveBeenCalledWith({
            target: "Presentation",
            appId: app.id,
            page: 3,
            pageCount: 3,
            status: "success",
            presentation: 3,
        });
    });

    it("rejects Presentation commands until controller and View agree", async () => {
        const restore = registerAppKind("Presentation");
        const manager = createManager();
        const nextPage = vi.fn(() => true);
        const app: any = {
            id: "Presentation-unconfirmed",
            kind: "Presentation",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Presentation/1" },
            getFullScenePath: () => "/Presentation/2",
            appResult: {
                pageState: () => ({ index: 1, length: 3 }),
                nextPage,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(false);
            expect(nextPage).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    it("does not map Presentation step commands to page commands in the unified API", async () => {
        const restore = registerAppKind("Presentation");
        const manager = createManager();
        const nextPage = vi.fn(() => true);
        const app: any = {
            id: "Presentation-no-step",
            kind: "Presentation",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Presentation/1" },
            getFullScenePath: () => "/Presentation/1",
            appResult: {
                pageState: () => ({ index: 0, length: 2 }),
                nextPage,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("nextStep", { target: app.id })
            ).resolves.toBe(false);
            expect(nextPage).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    it("reports an asynchronous app command rejection", async () => {
        const restore = registerAppKind("Slide");
        const manager = createManager();
        const failure = vi.fn();
        const app: any = {
            id: "Slide-async-failure",
            kind: "Slide",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Slide/1" },
            appResult: {
                position: () => [1, 2],
                controller: () => ({ ready: true }),
                slide: () => ({
                    isLoading: false,
                    isAnimating: false,
                    slideState: { currentSlideIndex: 1 },
                    on: vi.fn(),
                    off: vi.fn(),
                }),
                nextPage: () => Promise.resolve(false),
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });
        manager.emitter.on("unifiedPageStateChange", failure);

        try {
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(true);
            await flushEvents();
            expect(failure).toHaveBeenCalledWith({
                status: "failure",
                target: "Slide",
                appId: app.id,
                event: "nextPage",
                page: 2,
                pageCount: 2,
                reason: "commandFailed",
                message: undefined,
            });
        } finally {
            restore();
        }
    });

    it("observes Presentation async failure only in the unified API", async () => {
        const restore = registerAppKind("Presentation");
        const manager = createManager();
        const failure = vi.fn();
        const nextPage = vi.fn(() => true);
        const nextPageAsync = vi.fn(() => Promise.reject(new Error("scene path rejected")));
        const app: any = {
            id: "Presentation-async-failure",
            kind: "Presentation",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Presentation/1" },
            getFullScenePath: () => "/Presentation/1",
            appResult: {
                pageState: () => ({ index: 0, length: 2 }),
                nextPage,
                nextPageAsync,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });
        manager.emitter.on("unifiedPageStateChange", failure);

        try {
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(true);
            await flushEvents();
            expect(nextPageAsync).toHaveBeenCalledOnce();
            expect(nextPage).not.toHaveBeenCalled();
            expect(failure).toHaveBeenCalledWith({
                status: "failure",
                target: "Presentation",
                appId: app.id,
                event: "nextPage",
                page: 2,
                pageCount: 2,
                reason: "commandFailed",
                message: "Error: scene path rejected",
            });

            expect(manager.dispatchDocsEvent("nextPage", { appId: app.id })).toBe(true);
            expect(nextPage).toHaveBeenCalledOnce();
            expect(nextPageAsync).toHaveBeenCalledOnce();
        } finally {
            restore();
        }
    });

    it("does not lock consecutive accepted page commands behind completion", async () => {
        const restore = registerAppKind("Presentation");
        const manager = createManager();
        const resolvers: Array<(value: boolean) => void> = [];
        const nextPageAsync = vi.fn(
            () => new Promise<boolean>(resolve => resolvers.push(resolve))
        );
        const app: any = {
            id: "Presentation-consecutive",
            kind: "Presentation",
            appEmitter: new Emittery(),
            box: {},
            view: { focusScenePath: "/Presentation/1" },
            getFullScenePath: () => "/Presentation/1",
            appResult: {
                pageState: () => ({ index: 0, length: 2 }),
                nextPage: () => true,
                nextPageAsync,
            },
        };
        manager.queryOne = () => app;
        Object.defineProperty(manager, "canOperate", { value: true });

        try {
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(true);
            await expect(
                manager.dispatchPageEvent("nextPage", { target: app.id })
            ).resolves.toBe(true);
            expect(nextPageAsync).toHaveBeenCalledTimes(2);
            resolvers.forEach(resolve => resolve(true));
        } finally {
            restore();
        }
    });

    it("keeps legacy dispatchDocsEvent behavior while sharing command execution", () => {
        const manager = createManager();
        const nextPage = vi.fn(() => true);
        const app: any = {
            id: "Presentation-legacy",
            kind: "Presentation",
            appResult: { nextPage },
        };
        manager.queryOne = () => app;
        const restore = registerAppKind("Presentation");

        try {
            expect(manager.dispatchDocsEvent("nextStep", { appId: app.id })).toBe(true);
            expect(nextPage).toHaveBeenCalledOnce();
        } finally {
            restore();
        }
    });

    it("converts Presentation jump from 1-based page to 0-based index", () => {
        const jumpPage = vi.fn(() => true);

        expect(executeAppPageCommand("Presentation", { jumpPage } as any, "jumpToPage", 3)).toBe(
            true
        );
        expect(jumpPage).toHaveBeenCalledWith(2);
    });

    it("prefers the completion-aware Presentation jump in the unified API", async () => {
        const jumpPage = vi.fn(() => true);
        const jumpPageAsync = vi.fn(() => Promise.resolve(true));

        await expect(
            executeAppPageCommand(
                "Presentation",
                { jumpPage, jumpPageAsync } as any,
                "jumpToPage",
                3,
                true
            )
        ).resolves.toBe(true);
        expect(jumpPageAsync).toHaveBeenCalledWith(2);
        expect(jumpPage).not.toHaveBeenCalled();
    });

    it("releases per-app observers when the app is destroyed", async () => {
        const manager = createManager();
        const appEmitter = new Emittery();
        const app: any = {
            id: "Presentation-cleanup",
            kind: "Presentation",
            appEmitter,
            appResult: { pageState: () => ({ index: 0, length: 1 }) },
        };
        manager.queryOne = () => app;
        manager.ensureUnifiedAppObserver(app.id, app.kind);

        expect(manager._unifiedPageControl.hasAppObserver(app.id)).toBe(true);
        await appEmitter.emit("destroy", {});
        expect(manager._unifiedPageControl.hasAppObserver(app.id)).toBe(false);
    });

    it("rejects calls after destroy without reinstalling listeners", async () => {
        const manager = createManager();
        manager._destroyed = true;

        await expect(manager.dispatchPageEvent("nextPage")).resolves.toBe(false);
        await expect(manager.getPageState()).rejects.toThrow("window manager was destroyed");
        expect(manager._unifiedPageControl.isListenersInstalled).toBe(false);
    });

    it("deduplicates simple observed state and always exposes Slide source events", () => {
        const tracker = new UnifiedPageControlTracker();
        const mainState = { target: "mainView" as const, page: 1, pageCount: 2 };

        expect(tracker.emitObservedState("target:mainView", mainState)).toBe(true);
        expect(tracker.emitObservedState("target:mainView", mainState)).toBe(false);
        expect(tracker.emitObservedState("app:Slide-1", { ...mainState, target: "Slide" }, true)).toBe(
            true
        );
    });
});
