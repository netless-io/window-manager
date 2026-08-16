import { afterEach, describe, expect, it, vi } from "vitest";
import { AppBoxSizeSynchronizer } from "../src/App/AppBoxSizeSynchronizer";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

type TestView = {
    divElement: HTMLDivElement;
    size: { width: number; height: number };
    refreshSize?: ReturnType<typeof vi.fn>;
    screen?: {
        refreshSize: ReturnType<typeof vi.fn>;
        resizeObserver: {
            disconnect: ReturnType<typeof vi.fn>;
            observe: ReturnType<typeof vi.fn>;
        };
    };
};

const installAnimationFrame = () => {
    vi.useFakeTimers();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn(cb => {
        callbacks.push(cb);
        return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    return () => callbacks.shift()?.(0);
};

describe("AppProxy box size synchronization", () => {
    afterEach(() => {
        vi.useRealTimers();
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
        globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        vi.restoreAllMocks();
    });

    it("debounces changes and waits for two matching final DOM samples", async () => {
        const runFrame = installAnimationFrame();
        const element = document.createElement("div");
        const sizes = [
            { width: 600, height: 337.5 },
            { width: 620, height: 348.75 },
            { width: 640, height: 360 },
            { width: 640, height: 360 },
        ];
        vi.spyOn(element, "getBoundingClientRect").mockImplementation(
            () => sizes.shift() as DOMRect
        );
        const refreshSize = vi.fn();
        const view: TestView = {
            divElement: element,
            size: { width: 320, height: 180 },
            refreshSize,
        };
        const listener = vi.fn();
        const synchronizer = new AppBoxSizeSynchronizer(
            "app-1",
            () => view as any,
            () => element,
            listener
        );

        synchronizer.schedule();
        vi.advanceTimersByTime(400);
        synchronizer.schedule();
        vi.advanceTimersByTime(649);
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        runFrame();
        expect(listener).not.toHaveBeenCalled();
        for (let index = 0; index < 3; index += 1) {
            vi.advanceTimersByTime(100);
            runFrame();
        }
        await Promise.resolve();

        expect(refreshSize).toHaveBeenCalledWith(640, 360);
        expect(listener).toHaveBeenCalledWith({ appId: "app-1", width: 640, height: 360 });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("notifies apps without a whiteboard view from the box content element", () => {
        const runFrame = installAnimationFrame();
        const element = document.createElement("div");
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
            width: 480,
            height: 270,
        } as DOMRect);
        const listener = vi.fn();
        const synchronizer = new AppBoxSizeSynchronizer(
            "app-1",
            () => undefined,
            () => element,
            listener
        );

        synchronizer.schedule();
        vi.advanceTimersByTime(650);
        runFrame();
        vi.advanceTimersByTime(100);
        runFrame();

        expect(listener).toHaveBeenCalledWith({ appId: "app-1", width: 480, height: 270 });

        synchronizer.schedule();
        vi.advanceTimersByTime(650);
        runFrame();
        vi.advanceTimersByTime(100);
        runFrame();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("falls back to resetting the legacy screen observer", () => {
        const runFrame = installAnimationFrame();
        const element = document.createElement("div");
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
            width: 800,
            height: 450,
        } as DOMRect);
        const disconnect = vi.fn();
        const observe = vi.fn();
        const refreshSize = vi.fn();
        const view: TestView = {
            divElement: element,
            size: { width: 400, height: 225 },
            screen: {
                refreshSize,
                resizeObserver: { disconnect, observe },
            },
        };
        const synchronizer = new AppBoxSizeSynchronizer(
            "app-1",
            () => view as any,
            () => element,
            vi.fn()
        );

        synchronizer.schedule();
        vi.advanceTimersByTime(650);
        runFrame();
        vi.advanceTimersByTime(100);
        runFrame();

        expect(disconnect).toHaveBeenCalledOnce();
        expect(refreshSize).toHaveBeenCalledWith(800, 450);
        expect(observe).toHaveBeenCalledWith(element);
    });

    it("restores the legacy observer and still notifies when refresh fails", () => {
        const runFrame = installAnimationFrame();
        const element = document.createElement("div");
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
            width: 800,
            height: 450,
        } as DOMRect);
        const expectedError = new Error("refresh failed");
        const disconnect = vi.fn();
        const observe = vi.fn();
        const view: TestView = {
            divElement: element,
            size: { width: 400, height: 225 },
            screen: {
                refreshSize: vi.fn(() => {
                    throw expectedError;
                }),
                resizeObserver: { disconnect, observe },
            },
        };
        const listener = vi.fn();
        const onError = vi.fn();
        const synchronizer = new AppBoxSizeSynchronizer(
            "app-1",
            () => view as any,
            () => element,
            listener,
            onError
        );

        synchronizer.schedule();
        vi.advanceTimersByTime(650);
        runFrame();
        vi.advanceTimersByTime(100);

        expect(() => runFrame()).not.toThrow();
        expect(disconnect).toHaveBeenCalledOnce();
        expect(observe).toHaveBeenCalledWith(element);
        expect(onError).toHaveBeenCalledWith(expectedError);
        expect(listener).toHaveBeenCalledWith({ appId: "app-1", width: 800, height: 450 });
    });

    it("ignores non-positive and non-finite DOM sizes", () => {
        const runFrame = installAnimationFrame();
        const element = document.createElement("div");
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
            width: NaN,
            height: 0,
        } as DOMRect);
        const listener = vi.fn();
        const refreshSize = vi.fn();
        const synchronizer = new AppBoxSizeSynchronizer(
            "app-1",
            () => ({ divElement: element, size: { width: 1, height: 1 }, refreshSize } as any),
            () => element,
            listener
        );

        synchronizer.schedule();
        vi.advanceTimersByTime(650);
        runFrame();

        expect(refreshSize).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
    });

    it("cancels pending sampling when destroyed", () => {
        const runFrame = installAnimationFrame();
        const element = document.createElement("div");
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
            width: 640,
            height: 360,
        } as DOMRect);
        const listener = vi.fn();
        const synchronizer = new AppBoxSizeSynchronizer(
            "app-1",
            () => undefined,
            () => element,
            listener
        );

        synchronizer.schedule();
        synchronizer.destroy();
        vi.advanceTimersByTime(650);
        runFrame();

        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
    });
});
