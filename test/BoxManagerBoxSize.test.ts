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
});
