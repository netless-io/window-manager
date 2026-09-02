import { describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk", () => ({
    isPlayer: vi.fn(() => false),
}));

import { replaceRoomFunction } from "../src/Utils/RoomHacker";

describe("replaceRoomFunction", () => {
    it("routes room.setCameraBound through WindowManager", () => {
        const room = {
            scalePptToFit: vi.fn(),
            putScenes: vi.fn(),
            removeScenes: vi.fn(),
        };
        const manager = {
            setCameraBound: vi.fn(),
        };
        const cameraBound = { maxContentMode: () => 1 };

        replaceRoomFunction(room as any, manager as any);
        (room as any).setCameraBound(cameraBound);

        expect(manager.setCameraBound).toHaveBeenCalledWith(cameraBound);
    });

    it("schedules an active camera-and-size capture after scalePptToFit", () => {
        const originalScalePptToFit = vi.fn();
        const scheduleSetCameraAndSize = vi.fn();
        const room = {
            scalePptToFit: originalScalePptToFit,
            putScenes: vi.fn(),
            removeScenes: vi.fn(),
        };
        const manager = {
            appManager: { mainViewProxy: { scheduleSetCameraAndSize } },
        };

        replaceRoomFunction(room as any, manager as any);
        (room as any).scalePptToFit();

        expect(originalScalePptToFit).toHaveBeenCalledTimes(1);
        expect(scheduleSetCameraAndSize).toHaveBeenCalledTimes(1);
    });

    it("delegates originSize scalePptToFit coordination to MainViewProxy", () => {
        const originalScalePptToFit = vi.fn();
        const runScalePptToFit = vi.fn((callback: () => void) => callback());
        const scheduleSetCameraAndSize = vi.fn();
        const room = {
            scalePptToFit: originalScalePptToFit,
            putScenes: vi.fn(),
            removeScenes: vi.fn(),
        };
        const manager = {
            originSize: { width: 1920, height: 1080 },
            appManager: {
                mainViewProxy: { runScalePptToFit, scheduleSetCameraAndSize },
            },
        };

        replaceRoomFunction(room as any, manager as any);
        (room as any).scalePptToFit();

        expect(runScalePptToFit).toHaveBeenCalledTimes(1);
        expect(originalScalePptToFit).toHaveBeenCalledTimes(1);
        expect(scheduleSetCameraAndSize).not.toHaveBeenCalled();
    });
});
