import { afterEach, describe, expect, it, vi } from "vitest";

const originalCanvasRenderingContext2D = globalThis.CanvasRenderingContext2D;
const originalCustomEvent = globalThis.CustomEvent;

describe("BoxManager box size synchronization", () => {
    afterEach(() => {
        globalThis.CanvasRenderingContext2D = originalCanvasRenderingContext2D;
        globalThis.CustomEvent = originalCustomEvent;
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

            if (shouldForce) {
                expect(scheduleAppBoxSizeSync).toHaveBeenCalledWith("app-1", {
                    forceRefresh: true,
                });
            } else {
                expect(scheduleAppBoxSizeSync).not.toHaveBeenCalled();
            }
        }
    );
});
