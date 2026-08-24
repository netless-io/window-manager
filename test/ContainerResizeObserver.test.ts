import { afterEach, describe, expect, it, vi } from "vitest";
import { ContainerResizeObserver } from "../src/ContainerResizeObserver";

vi.mock("../src/index", () => ({
    WindowManager: class WindowManager {
        public static containerSizeRatio = 9 / 16;
    },
}));

const rect = (width: number, height: number): DOMRectReadOnly =>
    ({ width, height } as DOMRectReadOnly);

describe("ContainerResizeObserver diagnostics", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("samples and logs only the final container state after layout settles", () => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = { info: vi.fn() };
        const emitter = { emit: vi.fn(), on: vi.fn(() => vi.fn()) };
        const root = document.createElement("div");
        const playground = document.createElement("div");
        const sizer = document.createElement("div");
        const wrapper = document.createElement("div");
        root.appendChild(playground);
        playground.appendChild(sizer);
        sizer.appendChild(wrapper);
        const rootRectSpy = vi
            .spyOn(root, "getBoundingClientRect")
            .mockReturnValue(rect(640, 360) as DOMRect);
        const playgroundRectSpy = vi.spyOn(playground, "getBoundingClientRect").mockReturnValue(
            rect(640, 360) as DOMRect
        );
        const sizerRectSpy = vi
            .spyOn(sizer, "getBoundingClientRect")
            .mockReturnValue(rect(640, 360) as DOMRect);
        vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(rect(640, 360) as DOMRect);
        const mainView = document.createElement("div");
        const mainViewRectSpy = vi
            .spyOn(mainView, "getBoundingClientRect")
            .mockReturnValue(rect(640, 360) as DOMRect);
        const observer = new ContainerResizeObserver(emitter as any, logger as any, () => ({
            mainViewElement: mainView,
            mainViewSize: rect(640, 360),
            teleBoxContainerRect: rect(640, 360),
            mainViewDidRelease: false,
            containerSizeRatio: 9 / 16,
        }));

        observer.observePlaygroundSize(playground, sizer, wrapper);
        rootRectSpy.mockClear();
        playgroundRectSpy.mockClear();
        sizerRectSpy.mockClear();
        mainViewRectSpy.mockClear();
        observer.updateSizer(rect(0, 0), sizer, wrapper, "containerResizeObserver");
        observer.updateSizer(rect(640, 360), sizer, wrapper, "containerResizeObserver");
        observer.logCurrentState("bindContainer");
        vi.advanceTimersByTime(999);
        expect(logger.info).not.toHaveBeenCalled();
        expect(rootRectSpy).not.toHaveBeenCalled();
        expect(playgroundRectSpy).not.toHaveBeenCalled();
        expect(sizerRectSpy).not.toHaveBeenCalled();
        expect(mainViewRectSpy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(logger.info).toHaveBeenCalledOnce();
        expect(logger.info.mock.calls[0][0]).toContain(
            "[WindowManager][containerState]: origin: bindContainer"
        );
        expect(logger.info.mock.calls[0][0]).toContain(
            "mainViewDOM: 640x360, mainViewSize: 640x360, teleBoxRect: 640x360"
        );
        expect(logger.info.mock.calls[0][0]).toContain("observed: 640x360");
        expect(rootRectSpy).toHaveBeenCalledOnce();
        expect(playgroundRectSpy).toHaveBeenCalledOnce();
        expect(sizerRectSpy).toHaveBeenCalledOnce();
        expect(mainViewRectSpy).toHaveBeenCalledOnce();
        observer.disconnect();
    });

    it("drops a pending container state log when disconnected", () => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = { info: vi.fn() };
        const emitter = { emit: vi.fn(), on: vi.fn(() => vi.fn()) };
        const playground = document.createElement("div");
        const sizer = document.createElement("div");
        const wrapper = document.createElement("div");
        playground.appendChild(sizer);
        sizer.appendChild(wrapper);
        const observer = new ContainerResizeObserver(emitter as any, logger as any);

        observer.observePlaygroundSize(playground, sizer, wrapper);
        observer.disconnect();
        vi.advanceTimersByTime(1000);

        expect(logger.info).not.toHaveBeenCalled();
    });
});
