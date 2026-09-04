import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reaction } from "white-web-sdk";
import { MAIN_VIEW_CAMERA_COORDINATE_VERSION } from "../src/View/MainViewCameraTransform";

vi.mock("white-web-sdk", () => ({
    AnimationMode: { Immediately: 0, Continuous: 1 },
    ScenePathType: { None: "none", Page: "page", Dir: "dir" },
    UpdateEventKind: { Removed: "removed", Inserted: "inserted" },
    ViewMode: { Broadcaster: 0, Follower: 1, Freedom: 2 },
    listenUpdated: vi.fn(),
    reaction: vi.fn(() => () => undefined),
    unlistenUpdated: vi.fn(),
}));
vi.mock("../src/AttributesDelegate", () => ({
    Fields: {
        OriginCamera: "originCamera",
        OriginSize: "originSize",
        MainViewCamera: "mainViewCamera",
        MainViewSize: "mainViewSize",
        MainViewCameraCoordinateVersion: "_mainViewCameraCoordinateVersion",
    },
}));
vi.mock("../src/Utils/Common", () => ({
    setViewFocusScenePath: vi.fn(),
}));
import { MainViewProxy } from "../src/View/MainView";

type TestCamera = { centerX: number; centerY: number; scale: number };
type TestSize = { width: number; height: number };

function createHarness(
    configuredOriginSize?: TestSize,
    options: {
        empty?: boolean;
        legacy?: boolean;
        canOperate?: boolean;
        roomOriginSize?: TestSize;
        mainViewSize?: TestSize;
        mainViewCamera?: TestCamera;
        logger?: { info: ReturnType<typeof vi.fn> };
    } = {}
) {
    let camera: TestCamera = { centerX: 0, centerY: 0, scale: 1 };
    let size: TestSize = { width: 960, height: 540 };
    const callbacks = new Map<string, (value: any) => void>();
    const view = {
        get camera() {
            return camera;
        },
        get size() {
            return size;
        },
        callbacks: {
            on: vi.fn((name: string, callback: (value: any) => void) => {
                callbacks.set(name, callback);
            }),
            off: vi.fn((name: string) => callbacks.delete(name)),
        },
        moveCamera: vi.fn((next: Partial<TestCamera>) => {
            camera = {
                centerX: next.centerX ?? camera.centerX,
                centerY: next.centerY ?? camera.centerY,
                scale: next.scale ?? camera.scale,
            };
        }),
        moveCameraToContain: vi.fn(),
        setCameraBound: vi.fn(),
        release: vi.fn(),
        divElement: null,
        disableCameraTransform: false,
        focusScenePath: undefined,
    };

    const empty = Boolean(options.empty);
    const roomOriginSize = options.roomOriginSize ?? configuredOriginSize;
    const attributes = configuredOriginSize
        ? options.legacy
            ? {
                  originCamera: undefined,
                  originSize: undefined,
                  mainViewCamera: {
                      ...(options.mainViewCamera ?? {
                          centerX: 0,
                          centerY: 0,
                          scale: 1,
                      }),
                      id: "legacy",
                  },
                  mainViewSize: {
                      ...(options.mainViewSize ?? { width: 960, height: 540 }),
                      id: "legacy",
                  },
                  version: undefined,
              }
            : {
              originCamera: empty
                  ? undefined
                  : { centerX: 0, centerY: 0, scale: 1, id: "remote" },
              originSize:
                  empty || !roomOriginSize ? undefined : { ...roomOriginSize, id: "remote" },
              mainViewCamera: empty
                  ? undefined
                  : {
                        ...(options.mainViewCamera ?? {
                            centerX: 0,
                            centerY: 0,
                            scale: 1,
                        }),
                        id: "remote",
                    },
              mainViewSize: empty
                  ? undefined
                  : {
                        ...(options.mainViewSize ?? configuredOriginSize),
                        id: "remote",
                    },
              version: empty ? undefined : MAIN_VIEW_CAMERA_COORDINATE_VERSION,
          }
        : {
              originCamera: undefined,
              originSize: undefined,
              mainViewCamera: { centerX: 0, centerY: 0, scale: 1, id: "legacy" },
              mainViewSize: { width: 960, height: 540, id: "legacy" },
              version: undefined,
          };

    const initializationWrites: any[] = [];
    const cameraWrites: any[] = [];
    const pairWrites: any[] = [];
    const store = {
        getOriginCamera: () => attributes.originCamera,
        getOriginSize: () => attributes.originSize,
        getMainViewCamera: () => attributes.mainViewCamera,
        getMainViewSize: () => attributes.mainViewSize,
        getMainViewCameraCoordinateVersion: () => attributes.version,
        getMainViewScenePath: () => undefined,
        initializeOriginMainViewAttributes: (
            originCamera: any,
            originSize: any,
            mainViewCamera: any,
            mainViewSize: any
        ) => {
            initializationWrites.push({
                originCamera,
                originSize,
                mainViewCamera,
                mainViewSize,
            });
            attributes.originCamera = originCamera;
            attributes.originSize = originSize;
            attributes.mainViewCamera = mainViewCamera;
            attributes.mainViewSize = mainViewSize;
            attributes.version = MAIN_VIEW_CAMERA_COORDINATE_VERSION;
        },
        setMainViewCamera: (nextCamera: any) => {
            cameraWrites.push(nextCamera);
            attributes.mainViewCamera = nextCamera;
        },
        setMainViewCameraAndSize: (nextCamera: any, nextSize: any) => {
            pairWrites.push({ camera: nextCamera, size: nextSize });
            attributes.mainViewCamera = nextCamera;
            attributes.mainViewSize = nextSize;
        },
        setMainViewSize: vi.fn(),
        cleanFocus: vi.fn(),
    };
    const manager = {
        uid: "teacher",
        store,
        displayer: { views: { createView: () => view } },
        windowManger: {
            originSize: configuredOriginSize,
            viewMode: 0,
            Logger: options.logger,
            onMainViewScenePathChangeHandler: vi.fn(),
        },
        Logger: options.logger,
        refresher: { add: vi.fn(), remove: vi.fn() },
        room: undefined,
        canOperate: options.canOperate,
        dispatchInternalEvent: vi.fn(),
        boxManager: undefined,
    };
    const proxy = new MainViewProxy(manager as any);

    return {
        proxy,
        view,
        attributes,
        initializationWrites,
        cameraWrites,
        pairWrites,
        setSize(nextSize: TestSize) {
            size = nextSize;
        },
        setCamera(nextCamera: TestCamera) {
            camera = nextCamera;
        },
        emitSizeUpdated() {
            (proxy as any).onSizeUpdated(size);
        },
        emitCameraUpdated() {
            (proxy as any).onCameraUpdated(camera);
        },
        emitDeviceCameraUpdated(nextCamera: TestCamera) {
            camera = nextCamera;
            (proxy as any).onCameraUpdatedByDevice(nextCamera);
        },
    };
}

describe("MainViewProxy originSize mode", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("initializes the immutable origin pair and active pair atomically", () => {
        const harness = createHarness({ width: 1920, height: 1080 }, { empty: true });

        harness.proxy.ensureCameraAndSize();

        expect(harness.view.camera.scale).toBe(0.5);
        expect(harness.initializationWrites).toEqual([
            {
                originCamera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                originSize: { width: 1920, height: 1080, id: "teacher" },
                mainViewCamera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                mainViewSize: { width: 1920, height: 1080, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("renders a legacy active pair unchanged before migration", () => {
        const harness = createHarness(
            { width: 1920, height: 1080 },
            {
                legacy: true,
                mainViewSize: { width: 1280, height: 720 },
                mainViewCamera: { centerX: 10, centerY: 20, scale: 2 },
            }
        );

        expect(harness.view.camera).toEqual({ centerX: 10, centerY: 20, scale: 1.5 });
        harness.proxy.ensureCameraAndSize();
        expect(harness.view.camera).toEqual({ centerX: 10, centerY: 20, scale: 1.5 });
        expect(harness.initializationWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("resets a legacy active pair after becoming writable", () => {
        const harness = createHarness(
            { width: 1920, height: 1080 },
            {
                legacy: true,
                canOperate: true,
                mainViewSize: { width: 1280, height: 720 },
                mainViewCamera: { centerX: 10, centerY: 20, scale: 2 },
            }
        );
        harness.proxy.ensureCameraAndSize();

        expect(harness.view.camera).toEqual({ centerX: 0, centerY: 0, scale: 0.5 });
        expect(harness.initializationWrites).toEqual([
            {
                originCamera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                originSize: { width: 1920, height: 1080, id: "teacher" },
                mainViewCamera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                mainViewSize: { width: 1920, height: 1080, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("uses the active mainViewSize rather than originSize for local scale", () => {
        const harness = createHarness(
            { width: 1920, height: 1080 },
            {
                mainViewSize: { width: 1280, height: 720 },
                mainViewCamera: { centerX: 10, centerY: 20, scale: 2 },
            }
        );

        expect(harness.view.camera).toEqual({ centerX: 10, centerY: 20, scale: 1.5 });
        harness.proxy.destroy();
    });

    it("moveCamera updates only the active camera", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.moveCameraByApi({ centerX: 100, scale: 2 });
        expect(harness.view.camera).toEqual({ centerX: 100, centerY: 0, scale: 1 });
        expect(harness.proxy.getRelativeScale()).toBe(2);

        // The observable value follows the actual View camera, not the queued API target.
        harness.setCamera({ centerX: 100, centerY: 0, scale: 0.75 });
        expect(harness.proxy.getRelativeScale()).toBe(1.5);

        vi.advanceTimersByTime(500);
        expect(harness.cameraWrites).toEqual([
            { centerX: 100, centerY: 0, scale: 2, id: "teacher" },
        ]);
        expect(harness.pairWrites).toEqual([]);
        expect(harness.attributes.originSize).toEqual({
            width: 1920,
            height: 1080,
            id: "remote",
        });
        harness.proxy.destroy();
    });

    it("moveCameraToContain calculates against the active mainViewSize", () => {
        const harness = createHarness(
            { width: 1920, height: 1080 },
            { mainViewSize: { width: 1280, height: 720 } }
        );

        harness.proxy.moveCameraToContainByApi({
            originX: 100,
            originY: 200,
            width: 400,
            height: 200,
        });

        expect(harness.view.camera.centerX).toBe(300);
        expect(harness.view.camera.centerY).toBe(300);
        expect(harness.view.camera.scale).toBeCloseTo(2.4);
        vi.advanceTimersByTime(500);
        expect(harness.cameraWrites.at(-1)).toEqual({
            centerX: 300,
            centerY: 300,
            scale: 3.2,
            id: "teacher",
        });
        harness.proxy.destroy();
    });

    it("queues camera API work until the resized layout is stable", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.onUpdateContainerSizeRatio();
        harness.proxy.moveCameraByApi({ scale: 3 });
        expect(harness.view.camera.scale).toBe(0.5);

        harness.setSize({ width: 720, height: 1280 });
        harness.emitSizeUpdated();
        expect(harness.view.camera.scale).toBe(1.125);

        vi.advanceTimersByTime(500);
        expect(harness.cameraWrites.at(-1)?.scale).toBe(3);
        expect(harness.pairWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("setCameraBound changes only the local View", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        const cameraBound = { maxContentMode: () => 0.25 };

        harness.proxy.setCameraBoundByApi(cameraBound);
        vi.advanceTimersByTime(1500);

        expect(harness.view.setCameraBound).toHaveBeenCalledWith(
            expect.objectContaining({ maxContentMode: cameraBound.maxContentMode })
        );
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("keeps the effective CameraBound semantics across partial updates and rebind", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        const maxContentMode = () => 0.25;

        harness.proxy.setCameraBoundByApi({ centerX: 100, width: 1000, maxContentMode });
        harness.proxy.setCameraBoundByApi({});

        const effectiveCameraBound = {
            damping: undefined,
            centerX: 100,
            centerY: undefined,
            width: 1000,
            height: undefined,
            maxContentMode: undefined,
            minContentMode: undefined,
        };
        expect(harness.view.setCameraBound).toHaveBeenLastCalledWith(effectiveCameraBound);

        harness.proxy.rebind();
        expect(harness.view.setCameraBound).toHaveBeenLastCalledWith(effectiveCameraBound);
        harness.proxy.destroy();
    });

    it("setCameraAndSize replaces only the active pair", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        harness.setSize({ width: 1280, height: 800 });
        harness.setCamera({ centerX: 10, centerY: 20, scale: 1.25 });

        harness.proxy.setCameraAndSize();

        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 10, centerY: 20, scale: 1.25, id: "teacher" },
                size: { width: 1280, height: 800, id: "teacher" },
            },
        ]);
        expect(harness.attributes.originSize).toEqual({
            width: 1920,
            height: 1080,
            id: "remote",
        });
        harness.proxy.destroy();
    });

    it("delays active-pair capture until camera updates settle", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.scheduleSetCameraAndSize();
        vi.advanceTimersByTime(400);
        harness.setCamera({ centerX: 30, centerY: 40, scale: 1.5 });
        harness.emitCameraUpdated();
        vi.advanceTimersByTime(499);
        expect(harness.pairWrites).toEqual([]);

        vi.advanceTimersByTime(1);
        expect(harness.pairWrites.at(-1)?.camera).toEqual({
            centerX: 30,
            centerY: 40,
            scale: 1.5,
            id: "teacher",
        });
        harness.proxy.destroy();
    });

    it("keeps a PPT-fit capture pending without a recurring timer during layout sync", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.onUpdateContainerSizeRatio();
        harness.proxy.scheduleSetCameraAndSize();
        vi.advanceTimersByTime(2000);

        expect(harness.pairWrites).toEqual([]);
        expect((harness.proxy as any).cameraAndSizeCommitTimer).toBe(0);

        harness.setSize({ width: 720, height: 1280 });
        harness.emitSizeUpdated();
        vi.advanceTimersByTime(500);
        expect(harness.pairWrites).toHaveLength(1);
        harness.proxy.destroy();
    });

    it("preserves and applies scalePptToFit contain work queued during layout sync", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.onUpdateContainerSizeRatio();
        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });

        expect(harness.view.camera).toEqual({ centerX: 0, centerY: 0, scale: 0.5 });
        expect((harness.proxy as any).pendingOriginCameraOperations).toHaveLength(1);

        harness.setSize({ width: 720, height: 1280 });
        harness.emitSizeUpdated();

        expect(harness.view.camera.centerX).toBe(300);
        expect(harness.view.camera.centerY).toBe(300);
        expect(harness.view.camera.scale).toBeCloseTo(1.8);
        vi.advanceTimersByTime(500);
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toHaveLength(1);
        expect(harness.pairWrites[0].camera).toEqual(
            expect.objectContaining({ centerX: 300, centerY: 300, id: "teacher" })
        );
        expect(harness.pairWrites[0].camera.scale).toBeCloseTo(1.8);
        expect(harness.pairWrites[0].size).toEqual({
            width: 720,
            height: 1280,
            id: "teacher",
        });
        harness.proxy.destroy();
    });

    it("continues layout operations from the last successful camera after one operation fails", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        let didThrow = false;
        harness.view.moveCamera.mockImplementation((next: Partial<TestCamera>) => {
            if (next.centerX === 300 && next.centerY === 300 && !didThrow) {
                didThrow = true;
                throw new Error("camera operation failed");
            }
            harness.setCamera({
                centerX: next.centerX ?? harness.view.camera.centerX,
                centerY: next.centerY ?? harness.view.camera.centerY,
                scale: next.scale ?? harness.view.camera.scale,
            });
        });

        harness.proxy.onUpdateContainerSizeRatio();
        harness.proxy.moveCameraByApi({ centerX: 100 });
        harness.proxy.moveCameraToContainByApi({
            originX: 100,
            originY: 200,
            width: 400,
            height: 200,
        });
        harness.proxy.moveCameraByApi({ centerY: 200 });

        harness.setSize({ width: 720, height: 1280 });
        harness.emitSizeUpdated();
        vi.advanceTimersByTime(500);

        expect(didThrow).toBe(true);
        expect(harness.cameraWrites).toEqual([
            { centerX: 100, centerY: 200, scale: 1, id: "teacher" },
        ]);
        harness.proxy.destroy();
    });

    it("continues layout replay when applying the base camera fails", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        let moveCount = 0;
        harness.view.moveCamera.mockImplementation((next: Partial<TestCamera>) => {
            moveCount += 1;
            if (moveCount === 1) throw new Error("base camera failed");
            harness.setCamera({
                centerX: next.centerX ?? harness.view.camera.centerX,
                centerY: next.centerY ?? harness.view.camera.centerY,
                scale: next.scale ?? harness.view.camera.scale,
            });
        });

        harness.proxy.onUpdateContainerSizeRatio();
        harness.proxy.moveCameraByApi({ centerX: 100 });
        harness.setSize({ width: 720, height: 1280 });
        harness.emitSizeUpdated();
        vi.advanceTimersByTime(500);

        expect(moveCount).toBeGreaterThan(1);
        expect(harness.cameraWrites).toEqual([
            { centerX: 100, centerY: 0, scale: 1, id: "teacher" },
        ]);
        harness.proxy.destroy();
    });

    it("does not capture an active pair when scalePptToFit is a no-op", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => undefined);
        vi.advanceTimersByTime(2000);

        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("does not publish a local CameraBound adjustment during PPT-fit capture", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });

        harness.proxy.setCameraBoundByApi({ maxContentMode: () => 0.25 });
        harness.setCamera({ centerX: 300, centerY: 300, scale: 0.25 });
        harness.emitCameraUpdated();
        harness.proxy.setCameraAndSize();
        vi.advanceTimersByTime(500);

        expect(harness.view.camera.scale).toBe(0.25);
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 300, centerY: 300, scale: 2.4, id: "teacher" },
                size: { width: 960, height: 540, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("captures only the latest consecutive scalePptToFit result", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });
        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 0,
                originY: 0,
                width: 960,
                height: 540,
            });
        });

        vi.advanceTimersByTime(500);

        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 480, centerY: 270, scale: 1, id: "teacher" },
                size: { width: 960, height: 540, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("keeps the pending PPT-fit camera as the base for a later partial move", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });
        harness.emitCameraUpdated();
        vi.advanceTimersByTime(100);

        expect((harness.proxy as any).pendingOriginCameraOperations).toHaveLength(0);
        expect((harness.proxy as any).pendingCameraAndSizeCamera).toEqual({
            centerX: 300,
            centerY: 300,
            scale: 4.8,
        });

        harness.proxy.moveCameraByApi({ centerX: 400 });
        expect(harness.view.camera).toEqual({ centerX: 400, centerY: 300, scale: 2.4 });

        vi.advanceTimersByTime(1500);
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 400, centerY: 300, scale: 2.4, id: "teacher" },
                size: { width: 960, height: 540, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("replays the pending PPT-fit camera when resize starts after operation cleanup", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });
        harness.emitCameraUpdated();
        vi.advanceTimersByTime(100);

        harness.proxy.onUpdateContainerSizeRatio();
        harness.setSize({ width: 720, height: 1280 });
        harness.emitSizeUpdated();

        expect(harness.view.camera.centerX).toBe(300);
        expect(harness.view.camera.centerY).toBe(300);
        expect(harness.view.camera.scale).toBeCloseTo(1.8);

        vi.advanceTimersByTime(500);
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toHaveLength(1);
        expect(harness.pairWrites[0].camera).toEqual(
            expect.objectContaining({ centerX: 300, centerY: 300, id: "teacher" })
        );
        expect(harness.pairWrites[0].camera.scale).toBeCloseTo(1.8);
        expect(harness.pairWrites[0].size).toEqual({
            width: 720,
            height: 1280,
            id: "teacher",
        });
        harness.proxy.destroy();
    });

    it("preserves a pending PPT-fit active pair across rebind", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });
        harness.emitCameraUpdated();
        vi.advanceTimersByTime(100);

        harness.proxy.rebind();

        expect((harness.proxy as any).cameraAndSizeCommitPending).toBe(true);
        expect((harness.proxy as any).pendingCameraAndSizeCamera).toEqual({
            centerX: 300,
            centerY: 300,
            scale: 4.8,
        });

        vi.advanceTimersByTime(500);
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 300, centerY: 300, scale: 2.4, id: "teacher" },
                size: { width: 960, height: 540, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("fitOriginSizeAndCamera restores the active pair atomically", () => {
        const harness = createHarness(
            { width: 1920, height: 1080 },
            {
                mainViewSize: { width: 1280, height: 800 },
                mainViewCamera: { centerX: 10, centerY: 20, scale: 1.25 },
            }
        );

        harness.proxy.fitOriginSizeAndCamera();

        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                size: { width: 1920, height: 1080, id: "teacher" },
            },
        ]);
        expect(harness.view.camera).toEqual({ centerX: 0, centerY: 0, scale: 0.5 });
        expect(harness.attributes.originCamera).toEqual({
            centerX: 0,
            centerY: 0,
            scale: 1,
            id: "remote",
        });
        harness.proxy.destroy();
    });

    it("fitOriginSizeAndCamera cancels older camera and PPT-fit commits", () => {
        const harness = createHarness({ width: 1920, height: 1080 });

        harness.proxy.runScalePptToFit(() => {
            harness.proxy.moveCameraToContainByApi({
                originX: 100,
                originY: 200,
                width: 400,
                height: 200,
            });
        });
        harness.emitCameraUpdated();
        vi.advanceTimersByTime(100);
        expect((harness.proxy as any).pendingCameraAndSizeCamera).toEqual({
            centerX: 300,
            centerY: 300,
            scale: 4.8,
        });

        harness.proxy.fitOriginSizeAndCamera();
        vi.advanceTimersByTime(2000);

        expect((harness.proxy as any).pendingCameraAndSizeCamera).toBeUndefined();
        expect(harness.cameraWrites).toEqual([]);
        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                size: { width: 1920, height: 1080, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("fitOriginSizeAndCamera repairs an invalid active pair when the origin pair is valid", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        harness.attributes.mainViewCamera = {
            centerX: 0,
            centerY: 0,
            scale: 0,
            id: "broken-client",
        };
        harness.attributes.mainViewSize = { width: 0, height: 0, id: "broken-client" };

        harness.proxy.fitOriginSizeAndCamera();

        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                size: { width: 1920, height: 1080, id: "teacher" },
            },
        ]);
        harness.proxy.destroy();
    });

    it("normalizes device camera updates using the active size without changing it", () => {
        const harness = createHarness(
            { width: 1920, height: 1080 },
            { mainViewSize: { width: 1280, height: 720 } }
        );

        harness.emitDeviceCameraUpdated({ centerX: 5, centerY: 6, scale: 1.5 });

        expect(harness.cameraWrites).toEqual([
            { centerX: 5, centerY: 6, scale: 2, id: "teacher" },
        ]);
        expect(harness.pairWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("blocks publishing when the room originSize differs from mount", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const harness = createHarness(
            { width: 1920, height: 1080 },
            { roomOriginSize: { width: 1280, height: 720 } }
        );

        harness.proxy.moveCameraByApi({ scale: 2 });
        vi.advanceTimersByTime(500);

        expect(harness.cameraWrites).toEqual([]);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("room originSize"));
        consoleError.mockRestore();
        harness.proxy.destroy();
    });

    it("restores the local CameraBound after rebind without publishing attributes", () => {
        const harness = createHarness({ width: 1920, height: 1080 });
        const cameraBound = { centerX: 100, width: 1000, maxContentMode: () => 0.25 };

        harness.proxy.setCameraBoundByApi(cameraBound);
        harness.proxy.rebind();

        expect(harness.view.setCameraBound).toHaveBeenLastCalledWith(
            expect.objectContaining(cameraBound)
        );
        expect(harness.cameraWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("keeps legacy setCameraAndSize behavior when originSize is absent", () => {
        const harness = createHarness();

        harness.proxy.setCameraAndSize();

        expect(harness.pairWrites).toEqual([
            {
                camera: { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
                size: { width: 960, height: 540, id: "teacher" },
            },
        ]);
        expect(harness.initializationWrites).toEqual([]);
        harness.proxy.destroy();
    });

    it("reports only the final main view state after 300ms", () => {
        const logger = { info: vi.fn() };
        const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport");
        Object.defineProperty(window, "visualViewport", {
            configurable: true,
            value: {
                width: 390,
                height: 844,
                offsetLeft: 2,
                offsetTop: 3,
                scale: 1.5,
            },
        });

        try {
            const harness = createHarness(undefined, { logger });

            harness.setCamera({ centerX: 10, centerY: 20, scale: 1.5 });
            harness.emitCameraUpdated();
            vi.advanceTimersByTime(200);
            harness.setCamera({ centerX: 30, centerY: 40, scale: 2 });
            harness.setSize({ width: 720, height: 1280 });
            harness.emitSizeUpdated();

            vi.advanceTimersByTime(299);
            expect(logger.info).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);

            expect(logger.info).toHaveBeenCalledOnce();
            const message = logger.info.mock.calls[0][0] as string;
            const state = JSON.parse(message.slice(message.indexOf(": ") + 2));
            expect(message).toContain("[WindowManager][mainViewState]");
            expect(state.viewCamera).toEqual(harness.view.camera);
            expect(state.viewSize).toEqual(harness.view.size);
            expect(state.visualViewport).toEqual({
                width: 390,
                height: 844,
                offsetLeft: 2,
                offsetTop: 3,
                scale: 1.5,
            });
            harness.proxy.destroy();
        } finally {
            if (visualViewportDescriptor) {
                Object.defineProperty(window, "visualViewport", visualViewportDescriptor);
            } else {
                delete (window as Window & { visualViewport?: VisualViewport }).visualViewport;
            }
        }
    });

    it("ignores unrelated attributes replacements but observes real origin camera contract changes", () => {
        const reactionMock = vi.mocked(reaction);
        reactionMock.mockClear();
        const harness = createHarness({ width: 1920, height: 1080 });
        const scheduleMainViewStateLog = vi.fn();
        (harness.proxy as any).scheduleMainViewStateLog = scheduleMainViewStateLog;

        const disposeReaction = (harness.proxy as any).cameraReaction();
        const [expression, effect, options] = reactionMock.mock.calls.at(-1) as unknown as [
            () => unknown,
            () => void,
            { equals: (left: unknown, right: unknown) => boolean }
        ];
        const runReaction = (previous: unknown): unknown => {
            const next = expression();
            if (!options.equals(previous, next)) effect();
            return next;
        };

        let snapshot = expression();
        (harness.attributes as any).apps = {
            "Presentation-1": { view: { width: 640, height: 360 } },
        };
        snapshot = runReaction(snapshot);

        expect(scheduleMainViewStateLog).not.toHaveBeenCalled();
        expect(harness.view.moveCamera).toHaveBeenCalledTimes(1);

        harness.attributes.mainViewCamera = {
            centerX: 10,
            centerY: 20,
            scale: 2,
            id: "remote-2",
        };
        snapshot = runReaction(snapshot);

        expect(scheduleMainViewStateLog).toHaveBeenCalledOnce();
        expect(harness.view.moveCamera).toHaveBeenCalledTimes(2);

        harness.attributes.mainViewSize = { width: 1280, height: 720, id: "remote-3" };
        runReaction(snapshot);

        expect(scheduleMainViewStateLog).toHaveBeenCalledTimes(2);
        expect(harness.view.moveCamera).toHaveBeenCalledTimes(3);
        disposeReaction();
        harness.proxy.destroy();
    });
});
