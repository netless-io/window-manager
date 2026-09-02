import { Displayer, WindowManager } from "../src";
import { describe, it, vi, expect } from "vitest";
import { MAIN_VIEW_CAMERA_COORDINATE_VERSION } from "../src/View/MainViewCameraTransform";

vi.mock("white-web-sdk");
vi.mock("../src/Helper", () => ({
    checkVersion: vi.fn(),
    createInvisiblePlugin: vi.fn(),
    setupWrapper: vi.fn(),
}));

describe("WindowManager", () => {
    const displayer = {} as Displayer;

    it("constructor", async () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        expect(wm).toBeDefined();
        expect(wm.attributes).toBeDefined();
        expect(wm.setAttributes).toBeDefined();
    });

    it("waits for App setup and returns the created appId", async () => {
        const wm = new WindowManager({ kind: "WindowManager", displayer });
        const waitForSetup = vi.fn().mockResolvedValue({});
        const app = { waitForSetup };
        wm.appManager = { appProxies: new Map([["app-1", app]]) } as any;
        vi.spyOn(wm, "addApp").mockResolvedValue("app-1");

        await expect(wm.addAppAndWaitForSetup({ kind: "Presentation" })).resolves.toBe("app-1");
        expect(waitForSetup).toHaveBeenCalledOnce();
    });

    it("cleans a partial App and rethrows its original setup error", async () => {
        const wm = new WindowManager({ kind: "WindowManager", displayer });
        const error = new Error("presentation setup failed");
        const destroy = vi.fn().mockResolvedValue(undefined);
        const app = { waitForSetup: vi.fn().mockRejectedValue(error), destroy };
        wm.appManager = { appProxies: new Map([["app-1", app]]) } as any;
        vi.spyOn(wm, "addApp").mockResolvedValue("app-1");

        await expect(wm.addAppAndWaitForSetup({ kind: "Presentation" })).rejects.toBe(error);
        expect(destroy).toHaveBeenCalledWith(true, true, false, error);
    });

    it("routes setCameraBound through the main-view camera coordinator", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        const setCameraBoundByApi = vi.fn();
        wm.appManager = { mainViewProxy: { setCameraBoundByApi } } as any;
        const cameraBound = { maxContentMode: () => 1 };

        wm.setCameraBound(cameraBound);

        expect(setCameraBoundByApi).toHaveBeenCalledWith(cameraBound);
    });

    it("reports active setCameraBound calls through the room logger", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        const info = vi.fn();
        const setCameraBoundByApi = vi.fn();
        (wm as any)._roomLogger = { info };
        wm.appManager = {
            mainViewProxy: {
                setCameraBoundByApi,
                view: { size: { width: 960, height: 540 } },
            },
        } as any;

        wm.setCameraBound({
            centerX: 10,
            centerY: 20,
            width: 1920,
            height: 1080,
            maxContentMode: () => 2,
        });

        expect(info).toHaveBeenCalledWith(expect.stringContaining("setCameraBound"));
        expect(info).toHaveBeenCalledWith(expect.stringContaining('"hasMaxContentMode":true'));
        expect(info).toHaveBeenCalledWith(expect.stringContaining('"mainViewSize":{"width":960'));
    });

    it("rejects an invalid origin camera room contract", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        (wm as any)._originSize = { width: 1920, height: 1080 };
        Object.defineProperty(wm, "attributes", {
            configurable: true,
            value: {
                originCamera: { centerX: 0, centerY: 0, scale: 1, id: "remote" },
                originSize: { width: 1920, height: 1080, id: "remote" },
                mainViewCamera: { centerX: 0, centerY: 0, scale: 0, id: "remote" },
                mainViewSize: { width: 1920, height: 1080, id: "remote" },
                _mainViewCameraCoordinateVersion: MAIN_VIEW_CAMERA_COORDINATE_VERSION,
            },
        });

        expect(() => (wm as any).ensureOriginCameraCompatibility()).toThrow(
            /mainViewCamera is invalid/
        );
    });

    it("migrates a writable legacy active pair without changing it", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        const mainViewCamera = { centerX: 10, centerY: 20, scale: 1.5, id: "legacy" };
        const mainViewSize = { width: 1280, height: 720, id: "legacy" };
        const safeSetAttributes = vi.spyOn(wm, "safeSetAttributes").mockImplementation(() => {});
        (wm as any)._originSize = { width: 1920, height: 1080 };
        Object.defineProperty(wm, "attributes", {
            configurable: true,
            value: { mainViewCamera, mainViewSize },
        });
        Object.defineProperty(wm, "canOperate", { configurable: true, value: true });
        Object.defineProperty(wm, "room", {
            configurable: true,
            value: { uid: "teacher" },
        });

        (wm as any).ensureOriginCameraCompatibility();

        expect(safeSetAttributes).toHaveBeenCalledWith({
            originCamera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
            originSize: { width: 1920, height: 1080, id: "teacher" },
            mainViewCamera,
            mainViewSize,
            _mainViewCameraCoordinateVersion: MAIN_VIEW_CAMERA_COORDINATE_VERSION,
        });
    });

    it("allows a readonly client to mount with a valid legacy active pair", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        const safeSetAttributes = vi.spyOn(wm, "safeSetAttributes");
        (wm as any)._originSize = { width: 1920, height: 1080 };
        Object.defineProperty(wm, "attributes", {
            configurable: true,
            value: {
                mainViewCamera: { centerX: 10, centerY: 20, scale: 1.5, id: "legacy" },
                mainViewSize: { width: 1280, height: 720, id: "legacy" },
            },
        });
        Object.defineProperty(wm, "canOperate", { configurable: true, value: false });

        expect(() => (wm as any).ensureOriginCameraCompatibility()).not.toThrow();
        expect(safeSetAttributes).not.toHaveBeenCalled();
    });

    it("rejects a partial legacy active pair", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        (wm as any)._originSize = { width: 1920, height: 1080 };
        Object.defineProperty(wm, "attributes", {
            configurable: true,
            value: {
                mainViewCamera: { centerX: 10, centerY: 20, scale: 1.5, id: "legacy" },
            },
        });

        expect(() => (wm as any).ensureOriginCameraCompatibility()).toThrow(
            /complete origin and mainView camera contract/
        );
    });

    it("rolls back local resources without destroying the InvisiblePlugin", () => {
        const previousContainer = document.createElement("div");
        const previousParams = (WindowManager as any).params;
        const wm = new WindowManager({ kind: "WindowManager", displayer });
        const destroy = vi.spyOn(wm, "destroy");
        const logDestroy = vi.fn();
        const appManagerDestroy = vi.fn();
        (wm as any)._originSize = { width: 1920, height: 1080 };
        (wm as any).attributesDeboundceLog = { destroy: logDestroy };
        wm.appManager = { destroy: appManagerDestroy } as any;
        WindowManager.container = document.createElement("div");

        (WindowManager as any).rollbackFailedMount(wm, {
            displayer,
            wrapper: undefined,
            sizer: undefined,
            playground: undefined,
            container: previousContainer,
            debug: false,
            containerSizeRatio: 9 / 16,
            supportAppliancePlugin: undefined,
            params: previousParams,
            extendClass: undefined,
        });

        expect(destroy).not.toHaveBeenCalled();
        expect(logDestroy).toHaveBeenCalledTimes(1);
        expect(appManagerDestroy).toHaveBeenCalledTimes(1);
        expect(wm.originSize).toBeUndefined();
        expect((wm as any)._destroyed).toBe(false);
        expect((wm as any).attributesDeboundceLog).toBeUndefined();
        expect(WindowManager.container).toBe(previousContainer);
        expect((WindowManager as any).params).toBe(previousParams);

        WindowManager.container = undefined;
    });

    it("rejects a concurrent mount before it can replace singleton state", async () => {
        const previousDisplayer = WindowManager.displayer;
        (WindowManager as any).isCreated = false;
        (WindowManager as any).isMounting = true;

        await expect(WindowManager.mount({ room: {} as any })).rejects.toThrow(
            /Already created cannot be created again/
        );

        expect(WindowManager.displayer).toBe(previousDisplayer);
        (WindowManager as any).isMounting = false;
    });

    it("accepts an active mainViewSize that differs from the immutable originSize", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        (wm as any)._originSize = { width: 1920, height: 1080 };
        Object.defineProperty(wm, "attributes", {
            configurable: true,
            value: {
                originCamera: { centerX: 0, centerY: 0, scale: 1, id: "remote" },
                originSize: { width: 1920, height: 1080, id: "remote" },
                mainViewCamera: { centerX: 10, centerY: 20, scale: 1.5, id: "remote" },
                mainViewSize: { width: 1280, height: 800, id: "remote" },
                _mainViewCameraCoordinateVersion: MAIN_VIEW_CAMERA_COORDINATE_VERSION,
            },
        });

        expect(() => (wm as any).ensureOriginCameraCompatibility()).not.toThrow();
    });

    it("routes fitOriginSizeAndCamera through the main-view proxy", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        const fitOriginSizeAndCamera = vi.fn();
        wm.appManager = { mainViewProxy: { fitOriginSizeAndCamera } } as any;

        wm.fitOriginSizeAndCamera();

        expect(fitOriginSizeAndCamera).toHaveBeenCalledTimes(1);
    });
});
