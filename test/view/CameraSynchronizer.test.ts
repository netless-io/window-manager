import { TeleBoxRect } from "@netless/telebox-insider";
import { describe, it, beforeAll, vi, expect } from "vitest";
import { View } from "white-web-sdk";
import { CameraSynchronizer } from "../../src/View/CameraSynchronizer";


describe("CameraSynchronizer", () => {
    
    beforeAll(() => {
        vi.mock("white-web-sdk");
    });

    it("constructor", async () => {
        const cameraSynchronizer = new CameraSynchronizer(() => {});
        expect(cameraSynchronizer).toBeDefined();
    });

    it("onRemoteUpdate", async () => {
        const saveCamera = vi.fn();
        vi.useFakeTimers();
        const cameraSynchronizer = new CameraSynchronizer(saveCamera);
        const view: Partial<View> = {
            moveCamera: vi.fn(camera => {
                delete (camera as any).animationMode;
                Object.assign(view.camera as any, camera);
            }),
            camera: {
                centerX: 0,
                centerY: 0,
                scale: 1,
            }
        }
        cameraSynchronizer.setView(view as View);
    
        const rect: TeleBoxRect = {
            width: 500,
            height: 500,
            x: 0,
            y: 0,
        }
        cameraSynchronizer.setRect(rect);
        const nextCamera = {
            id: "test",
            scale: 1.5,
            centerX: 0,
            centerY: 0,
        }
        const nextSize = {
            width: 600,
            height: 600,
            id: "test"
        }
        cameraSynchronizer.onRemoteUpdate(nextCamera, nextSize);
        vi.advanceTimersByTime(50);
        
        expect(view.camera).toEqual({ centerX: 0, centerY: 0, scale: nextCamera.scale * (rect.width / nextSize.width) });
    });
});
