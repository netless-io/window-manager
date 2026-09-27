import { afterEach, describe, expect, it, vi } from "vitest";

const originalCanvasRenderingContext2D = globalThis.CanvasRenderingContext2D;
const originalCustomEvent = globalThis.CustomEvent;

describe("BoxManager box size synchronization", () => {
    afterEach(() => {
        globalThis.CanvasRenderingContext2D = originalCanvasRenderingContext2D;
        globalThis.CustomEvent = originalCustomEvent;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("schedules a size sync when minimum size may clamp the box", async () => {
        vi.stubGlobal("CanvasRenderingContext2D", class CanvasRenderingContext2D {});
        vi.stubGlobal("CustomEvent", window.CustomEvent);
        vi.spyOn(window, "dispatchEvent").mockReturnValue(true);
        const { BoxManager } = await import("../src/BoxManager");
        const update = vi.fn();
        const scheduleAppBoxSizeSync = vi.fn();
        const manager = Object.create(BoxManager.prototype) as BoxManager & {
            teleBoxManager: { update: typeof update };
            context: { scheduleAppBoxSizeSync: typeof scheduleAppBoxSizeSync };
        };
        manager.teleBoxManager = { update };
        manager.context = { scheduleAppBoxSizeSync };

        manager.setBoxMinSize({ appId: "app-1", minWidth: 0.4, minHeight: 0.3 });

        expect(update).toHaveBeenCalledWith(
            "app-1",
            { minWidth: 0.4, minHeight: 0.3 },
            true
        );
        expect(scheduleAppBoxSizeSync).toHaveBeenCalledWith("app-1");
    });

    it.each([
        ["globally maximized", false, true, true],
        ["normal", false, false, false],
        ["independent box status", true, true, false],
    ])(
        "forces focused app size sync only when %s",
        async (_name, useBoxesStatus, maximized, shouldForce) => {
            vi.stubGlobal("CanvasRenderingContext2D", class CanvasRenderingContext2D {});
            vi.stubGlobal("CustomEvent", window.CustomEvent);
            vi.spyOn(window, "dispatchEvent").mockReturnValue(true);
            const { BoxManager } = await import("../src/BoxManager");
            const handlers = new Map<string, (value: any) => void>();
            const reaction = vi.fn();
            const teleBoxManager = {
                maximized,
                events: {
                    on: vi.fn((event: string, handler: (value: any) => void) => {
                        handlers.set(event, handler);
                    }),
                },
                _state$: { reaction },
                _darkMode$: { reaction },
                _prefersColorScheme$: { reaction },
                _minimized$: { reaction },
            };
            vi.spyOn(BoxManager.prototype as any, "setupBoxManager").mockReturnValue(
                teleBoxManager
            );
            const scheduleAppBoxSizeSync = vi.fn();
            const context = {
                emitter: { emit: vi.fn(), on: vi.fn() },
                callbacks: { emit: vi.fn() },
                boxEmitter: { emit: vi.fn() },
                canOperate: () => true,
                scheduleAppBoxSizeSync,
            };
            new BoxManager(context as any, { useBoxesStatus });

            handlers.get("focused")?.({ id: "app-1" });

            expect(context.boxEmitter.emit).toHaveBeenCalledWith("focus", {
                appId: "app-1",
                source: "telebox",
            });

            if (shouldForce) {
                expect(scheduleAppBoxSizeSync).toHaveBeenCalledWith("app-1", {
                    forceRefresh: true,
                });
            } else {
                expect(scheduleAppBoxSizeSync).not.toHaveBeenCalled();
            }
        }
    );

    it("marks BoxManager.focusBox calls as programmatic", async () => {
        vi.stubGlobal("CanvasRenderingContext2D", class CanvasRenderingContext2D {});
        vi.stubGlobal("CustomEvent", window.CustomEvent);
        vi.spyOn(window, "dispatchEvent").mockReturnValue(true);
        const { BoxManager } = await import("../src/BoxManager");
        const handlers = new Map<string, (value: any) => void>();
        const teleBoxManager = {
            maximized: true,
            events: {
                on: vi.fn((event: string, handler: (value: any) => void) => {
                    handlers.set(event, handler);
                }),
            },
            _state$: { reaction: vi.fn() },
            _darkMode$: { reaction: vi.fn() },
            _prefersColorScheme$: { reaction: vi.fn() },
            _minimized$: { reaction: vi.fn() },
            focusBox: vi.fn((appId: string) => {
                handlers.get("focused")?.({ id: appId });
            }),
            focusBoxCommitted: vi.fn((appId: string) => {
                handlers.get("focused")?.({ id: appId });
            }),
        };
        vi.spyOn(BoxManager.prototype as any, "setupBoxManager").mockReturnValue(
            teleBoxManager
        );
        const context = {
            emitter: { emit: vi.fn(), on: vi.fn() },
            callbacks: { emit: vi.fn() },
            boxEmitter: { emit: vi.fn() },
            canOperate: () => true,
            scheduleAppBoxSizeSync: vi.fn(),
        };
        const manager = new BoxManager(context as any);

        manager.focusBox({ appId: "app-1" }, false);

        expect(context.boxEmitter.emit).toHaveBeenCalledWith("focus", {
            appId: "app-1",
            source: "programmatic",
        });
    });

    it("does not apply restored box focus before lazy setup completes", async () => {
        vi.useFakeTimers();
        const { BoxManager } = await import("../src/BoxManager");
        const manager = Object.create(BoxManager.prototype) as any;
        manager.teleBoxManager = {
            queryOne: vi.fn(() => ({ id: "app-1" })),
            update: vi.fn(),
            focusBox: vi.fn(),
        };
        manager.context = {
            isLazySetup: () => true,
            scheduleAppBoxSizeSync: vi.fn(),
            callbacks: { emit: vi.fn() },
        };

        manager.updateBoxState({ id: "app-1", focus: true });
        vi.advanceTimersByTime(50);

        expect(manager.teleBoxManager.focusBox).not.toHaveBeenCalled();
    });

    it("does not restore normal state while forceMaximized is enabled", async () => {
        vi.useFakeTimers();
        const { BoxManager } = await import("../src/BoxManager");
        const manager = Object.create(BoxManager.prototype) as any;
        manager.teleBoxManager = {
            queryOne: vi.fn(() => ({ id: "app-1" })),
            update: vi.fn(),
            forceMaximized: true,
            maximized: true,
            setMaximized: vi.fn(),
            setMinimized: vi.fn(),
        };
        manager.context = {
            scheduleAppBoxSizeSync: vi.fn(),
            callbacks: { emit: vi.fn() },
        };

        manager.updateBoxState({ id: "app-1", maximized: false, minimized: false });
        vi.advanceTimersByTime(50);

        expect(manager.teleBoxManager.setMaximized).not.toHaveBeenCalled();
        expect(manager.teleBoxManager.setMinimized).toHaveBeenCalledWith(false, true);
    });

    it("creates a lazy box below the visible box and defers restored zIndex", async () => {
        const { BoxManager } = await import("../src/BoxManager");
        const manager = Object.create(BoxManager.prototype) as any;
        const create = vi.fn();
        const update = vi.fn();
        manager.teleBoxManager = {
            topBox: { id: "previous", zIndex: 315 },
            useBoxesStatus: false,
            containerRect: { width: 1000, height: 800 },
            create,
            queryOne: vi.fn(() => ({ id: "target" })),
            update,
        };
        manager.context = {
            isLazySetup: () => true,
            emitter: { emit: vi.fn() },
            callbacks: { emit: vi.fn() },
            scheduleAppBoxSizeSync: vi.fn(),
        };

        manager.createBox({ appId: "target", app: { config: {} }, smartPosition: true });
        expect(create.mock.calls[0][0].zIndex).toBe(314);
        manager.updateBoxState({ id: "target", zIndex: 317 });
        expect(update.mock.calls[0][1].zIndex).toBeUndefined();
    });

    it("keeps eager box creation and restored zIndex unchanged", async () => {
        const { BoxManager } = await import("../src/BoxManager");
        const manager = Object.create(BoxManager.prototype) as any;
        const create = vi.fn();
        const update = vi.fn();
        manager.teleBoxManager = {
            topBox: { id: "previous", zIndex: 315 },
            useBoxesStatus: false,
            containerRect: { width: 1000, height: 800 },
            create,
            queryOne: vi.fn(() => ({ id: "target" })),
            update,
        };
        manager.context = {
            isLazySetup: () => false,
            emitter: { emit: vi.fn() },
            callbacks: { emit: vi.fn() },
            scheduleAppBoxSizeSync: vi.fn(),
        };

        manager.createBox({ appId: "target", app: { config: {} } });
        expect(create.mock.calls[0][0].zIndex).toBeUndefined();
        manager.updateBoxState({ id: "target", zIndex: 317 });
        expect(update.mock.calls[0][1].zIndex).toBe(317);
    });

    it("routes lazy focusTopBox through the pending request", async () => {
        const { BoxManager } = await import("../src/BoxManager");
        const manager = Object.create(BoxManager.prototype) as any;
        manager.teleBoxManager = { query: vi.fn(() => [{ id: "app-1" }]) };
        manager.getTopBox = vi.fn(() => ({ id: "app-1" }));
        manager.context = {
            isLazySetup: () => true,
            requestAppFocus: vi.fn(),
        };
        manager.focusBox = vi.fn();

        manager.focusTopBox();

        expect(manager.context.requestAppFocus).toHaveBeenCalledWith("app-1");
        expect(manager.focusBox).not.toHaveBeenCalled();
    });

    it.each([
        ["non-lazy readonly", false, true],
        ["lazy readonly", true, false],
    ])("%s does not blur a focused box", async (_name, isLazySetup, shouldBlur) => {
        vi.stubGlobal("CanvasRenderingContext2D", class CanvasRenderingContext2D {});
        vi.stubGlobal("CustomEvent", window.CustomEvent);
        vi.spyOn(window, "dispatchEvent").mockReturnValue(true);
        const { BoxManager } = await import("../src/BoxManager");
        const handlers = new Map<string, (value: any) => void>();
        const teleBoxManager = {
            maximized: true,
            events: {
                on: vi.fn((event: string, handler: (value: any) => void) => {
                    handlers.set(event, handler);
                }),
            },
            _state$: { reaction: vi.fn() },
            _darkMode$: { reaction: vi.fn() },
            _prefersColorScheme$: { reaction: vi.fn() },
            _minimized$: { reaction: vi.fn() },
        };
        vi.spyOn(BoxManager.prototype as any, "setupBoxManager").mockReturnValue(
            teleBoxManager
        );
        const scheduleAppBoxSizeSync = vi.fn();
        const context = {
            emitter: { emit: vi.fn(), on: vi.fn() },
            callbacks: { emit: vi.fn() },
            boxEmitter: { emit: vi.fn() },
            canOperate: () => false,
            isLazySetup: () => isLazySetup,
            scheduleAppBoxSizeSync,
        };
        const blurBox = vi.fn();
        Object.defineProperty(teleBoxManager, "blurBox", { value: blurBox });

        new BoxManager(context as any);

        handlers.get("focused")?.({ id: "app-1" });

        expect(scheduleAppBoxSizeSync).toHaveBeenCalledWith("app-1", {
            forceRefresh: true,
        });
        if (shouldBlur) {
            expect(blurBox).toHaveBeenCalledWith("app-1");
        } else {
            expect(blurBox).not.toHaveBeenCalled();
        }
    });

    it("returns the highest-z box after excluding a failed focus target", async () => {
        const { BoxManager } = await import("../src/BoxManager");
        const manager = Object.create(BoxManager.prototype) as BoxManager & {
            teleBoxManager: { query: () => Array<{ id: string; zIndex: number }> };
        };
        manager.teleBoxManager = {
            query: () => [
                { id: "failed", zIndex: 30 },
                { id: "lower", zIndex: 10 },
                { id: "fallback", zIndex: 20 },
            ],
        };

        expect(manager.getTopBox("failed")?.id).toBe("fallback");
    });

    it("never lowers an existing DOM zIndex in lazy mode", async () => {
        const { BoxManager } = await import("../src/BoxManager");
        const box = { id: "app-1", zIndex: 101 };
        const update = vi.fn((_: string, value: { zIndex: number }) => {
            box.zIndex = value.zIndex;
        });
        const manager = Object.create(BoxManager.prototype) as BoxManager & {
            teleBoxManager: { queryOne: () => typeof box; update: typeof update };
            context: { isLazySetup: () => boolean };
        };
        manager.teleBoxManager = { queryOne: () => box, update };
        manager.context = { isLazySetup: () => true };

        manager.setZIndex("app-1", 99);
        manager.setZIndex("app-1", 101);
        expect(box.zIndex).toBe(101);
        expect(update).not.toHaveBeenCalled();

        manager.setZIndex("app-1", 103);
        expect(box.zIndex).toBe(103);
        expect(update).toHaveBeenCalledOnce();
    });
});
