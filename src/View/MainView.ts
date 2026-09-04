import { AnimationMode, reaction, ViewMode } from "white-web-sdk";
import { callbacks } from "../callback";
import { createView, DefaultCameraBound } from "./ViewManager";
import { debounce, get, isEmpty, isEqual } from "lodash";
import { internalEmitter } from "../InternalEmitter";
import { Fields } from "../AttributesDelegate";
import { setViewFocusScenePath } from "../Utils/Common";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, CameraBound, Rectangle, Room, Size, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { MainViewCamera } from "../AttributesDelegate";
import { Events, ROOM_LOG_DEBOUNCE_MIN } from "../constants";
import {
    MAIN_VIEW_CAMERA_COORDINATE_VERSION,
    isSameOriginSize,
    isLegacyMainViewCameraContract,
    isValidCamera,
    isValidSize,
    localCameraToMainView,
    mainViewCameraToContain,
    mainViewCameraToLocal,
} from "./MainViewCameraTransform";

type MainViewScreenLike = {
    refreshSize?: (width: number, height: number) => void;
    resizeObserver?: {
        disconnect?: () => void;
        observe?: (target: Element) => void;
    };
};

type MoveCameraParams = Partial<Camera> & { animationMode?: AnimationMode };
type MoveCameraToContainParams = Rectangle & { animationMode?: AnimationMode };
type OriginCameraCommitMode = "camera-only" | "camera-and-size";
type CameraAndSizeCommitOptions = {
    preserveOriginCameraOperations?: boolean;
};
type OriginCameraOperation =
    | {
          kind: "move";
          camera: MoveCameraParams;
          targetCamera?: Camera;
          targetReferenceSize?: Size;
          commitMode: OriginCameraCommitMode;
      }
    | {
          kind: "contain";
          rectangle: MoveCameraToContainParams;
          targetCamera?: Camera;
          targetReferenceSize?: Size;
          commitMode: OriginCameraCommitMode;
      };

type ScalePptToFitContext = {
    didRequestContain: boolean;
};

const DefaultOriginCamera: Camera = { centerX: 0, centerY: 0, scale: 1 };
const LayoutSizeEpsilon = 0.5;
const MaxPendingOriginCameraOperations = 64;
const OriginCameraMaxCommitDelay = 1000;

export class MainViewProxy {
    /** Refresh the view's camera in an interval of 1.5s. */
    public polling = false;

    private scale?: number;
    private started = false;
    private mainViewIsAddListener = false;
    private isForcingMainViewDivElement = false;
    private wrapperRectWorkaroundFrame = 0;
    private pendingWrapperRectChange?: { width: number; height: number; origin?: string };
    private layoutRevision = 0;
    private layoutSyncing = false;
    private expectedLayoutSize?: Size;
    private pendingOriginCameraOperations: OriginCameraOperation[] = [];
    private originCameraOperationBaseCamera?: Camera;
    private cameraBound: CameraBound = { ...DefaultCameraBound };
    private originCameraCommitTimer = 0;
    private originCameraMaxCommitTimer = 0;
    private cameraAndSizeCommitTimer = 0;
    private cameraAndSizeCommitPending = false;
    private pendingCameraAndSizeCamera?: Camera;
    private pendingCameraAndSizeReferenceSize?: Size;
    private scalePptToFitContext?: ScalePptToFitContext;
    private originConfigurationError?: string;
    private mainView: View;
    private store = this.manager.store;
    private viewMode = this.manager.windowManger.viewMode;

    private sideEffectManager = new SideEffectManager();

    private mainViewStateLogTimer?: ReturnType<typeof setTimeout>;

    constructor(private manager: AppManager) {
        this.mainView = this.createMainView();
        this.moveCameraSizeByAttributes();
        internalEmitter.once("mainViewMounted").then(() => {
            this.addMainViewListener();
            this.start();
            this.ensureCameraAndSize();
            this.startListenWritableChange();
        });
        const playgroundSizeChangeListener = () => {
            this.sizeChangeHandler(this.mainViewSize);
            this.scheduleMainViewStateLog();
        };
        this.sideEffectManager.add(() => {
            return internalEmitter.on("playgroundSizeChange", playgroundSizeChangeListener);
        });
        this.sideEffectManager.add(() => {
            return internalEmitter.on("containerSizeRatioUpdate", this.onUpdateContainerSizeRatio);
        });
        this.sideEffectManager.add(() => {
            return internalEmitter.on("wrapperRectChange", this.onWrapperRectChange);
        });
        this.sideEffectManager.add(() => {
            return internalEmitter.on("startReconnect", () => {
                this.beginOriginLayoutSync();
                if (!this.didRelease) {
                    this.mainView.release();
                }
            });
        });
        this.sideEffectManager.setInterval(this.syncCamera, 1500);
    }

    // Guard function when the camera is not synced
    private syncCamera = () => {
        if (!this.polling || this.viewMode !== ViewMode.Broadcaster) return;
        const { mainViewCamera } = this;
        if (mainViewCamera && mainViewCamera.id !== this.manager.uid) {
            this.moveCameraSizeByAttributes();
        }
    };

    private startListenWritableChange = () => {
        this.sideEffectManager.add(() => {
            return internalEmitter.on("writableChange", isWritable => {
                if (isWritable) {
                    this.ensureCameraAndSize();
                }
                if (this.manager.room) this.syncMainView(this.manager.room);
            });
        });
    };

    public ensureCameraAndSize() {
        if (this.viewMode !== ViewMode.Broadcaster) return;
        if (this.isOriginMode) {
            const originSize = this.originSize;
            if (originSize && this.hasLegacyOriginAttributes() && this.manager.canOperate) {
                this.migrateLegacyOriginAttributes();
                this.applyMainViewCamera(
                    DefaultOriginCamera,
                    AnimationMode.Immediately,
                    originSize
                );
                return;
            }
            const camera = this.currentOriginCameraForApi();
            if (camera && originSize) {
                this.applyMainViewCamera(camera);
                if (this.hasEmptyOriginAttributes()) {
                    this.initializeOriginAttributes(camera, originSize);
                }
            }
            return;
        }
        if (!this.mainViewCamera || !this.mainViewSize) {
            this.manager.dispatchInternalEvent(Events.InitMainViewCamera);
            this.setCameraAndSize();
        }
    }

    private get mainViewCamera() {
        return this.store.getMainViewCamera();
    }

    private get mainViewSize() {
        return this.store.getMainViewSize();
    }

    private get mainViewCameraCoordinateVersion() {
        return this.store.getMainViewCameraCoordinateVersion();
    }

    private get roomOriginCamera() {
        return this.store.getOriginCamera();
    }

    private get roomOriginSize() {
        return this.store.getOriginSize();
    }

    private get originSize(): Size | undefined {
        return this.manager.windowManger.originSize;
    }

    private get isOriginMode(): boolean {
        return this.originSize !== undefined;
    }

    private get didRelease(): boolean {
        return get(this.view, ["didRelease"]);
    }

    private hasEmptyOriginAttributes(): boolean {
        return (
            this.roomOriginCamera === undefined &&
            this.roomOriginSize === undefined &&
            this.mainViewCamera === undefined &&
            this.mainViewSize === undefined &&
            this.mainViewCameraCoordinateVersion === undefined
        );
    }

    private hasLegacyOriginAttributes(): boolean {
        return isLegacyMainViewCameraContract(
            this.roomOriginCamera,
            this.roomOriginSize,
            this.mainViewCamera,
            this.mainViewSize,
            this.mainViewCameraCoordinateVersion
        );
    }

    private reportOriginConfigurationError(message: string): void {
        if (this.originConfigurationError === message) return;
        this.originConfigurationError = message;
        console.error(message);
        this.manager.windowManger.Logger?.error(message);
    }

    private hasValidOriginAttributes(
        action: "ignore" | "block",
        validateActivePair = true
    ): boolean {
        const originSize = this.originSize;
        if (!originSize) return false;
        if (this.hasEmptyOriginAttributes()) {
            this.originConfigurationError = undefined;
            return true;
        }
        if (this.mainViewCameraCoordinateVersion !== MAIN_VIEW_CAMERA_COORDINATE_VERSION) {
            this.reportOriginConfigurationError(
                `[WindowManager]: ${action} mainView camera with coordinate version ${String(
                    this.mainViewCameraCoordinateVersion
                )} in originSize mode`
            );
            return false;
        }
        if (!isSameOriginSize(this.roomOriginSize, originSize)) {
            this.reportOriginConfigurationError(
                `[WindowManager]: ${action} room originSize ${JSON.stringify(
                    this.roomOriginSize
                )}; expected ${JSON.stringify(originSize)}`
            );
            return false;
        }
        if (
            !isValidCamera(this.roomOriginCamera) ||
            this.roomOriginCamera.centerX !== DefaultOriginCamera.centerX ||
            this.roomOriginCamera.centerY !== DefaultOriginCamera.centerY ||
            this.roomOriginCamera.scale !== DefaultOriginCamera.scale
        ) {
            this.reportOriginConfigurationError(
                `[WindowManager]: ${action} invalid room originCamera ${JSON.stringify(
                    this.roomOriginCamera
                )}`
            );
            return false;
        }
        if (!validateActivePair) {
            this.originConfigurationError = undefined;
            return true;
        }
        if (!isValidSize(this.mainViewSize)) {
            this.reportOriginConfigurationError(
                `[WindowManager]: ${action} invalid mainViewSize ${JSON.stringify(
                    this.mainViewSize
                )}`
            );
            return false;
        }
        if (!isValidCamera(this.mainViewCamera)) {
            this.reportOriginConfigurationError(
                `[WindowManager]: ${action} invalid mainViewCamera ${JSON.stringify(
                    this.mainViewCamera
                )}`
            );
            return false;
        }
        this.originConfigurationError = undefined;
        return true;
    }

    private readMainViewCamera(): Camera | undefined {
        if (!this.originSize) return undefined;
        if (this.hasEmptyOriginAttributes()) return { ...DefaultOriginCamera };
        if (!this.hasLegacyOriginAttributes() && !this.hasValidOriginAttributes("ignore"))
            return undefined;
        return {
            centerX: this.mainViewCamera.centerX,
            centerY: this.mainViewCamera.centerY,
            scale: this.mainViewCamera.scale,
        };
    }

    private readMainViewReferenceSize(): Size | undefined {
        if (!this.originSize) return undefined;
        if (this.hasEmptyOriginAttributes()) return this.originSize;
        if (!this.hasLegacyOriginAttributes() && !this.hasValidOriginAttributes("ignore"))
            return undefined;
        return { width: this.mainViewSize.width, height: this.mainViewSize.height };
    }

    private applyMainViewCamera(
        camera: Camera,
        animationMode: AnimationMode = AnimationMode.Immediately,
        referenceSizeOverride?: Size
    ): Camera | undefined {
        const referenceSize = referenceSizeOverride || this.readMainViewReferenceSize();
        if (!referenceSize || !isValidCamera(camera)) return undefined;
        const localCamera = mainViewCameraToLocal(camera, referenceSize, this.view.size);
        if (!localCamera) return undefined;
        if (isEqual(localCamera, this.view.camera)) return camera;
        this.view.moveCamera({ ...localCamera, animationMode });
        return camera;
    }

    private initializeOriginAttributes(camera: Camera, mainViewSize: Size): void {
        const originSize = this.originSize;
        if (!originSize || !isValidCamera(camera) || !isValidSize(mainViewSize)) return;
        const originCamera = { ...DefaultOriginCamera, id: this.manager.uid };
        this.store.initializeOriginMainViewAttributes(
            originCamera,
            { ...originSize, id: this.manager.uid },
            { ...camera, id: this.manager.uid },
            { ...mainViewSize, id: this.manager.uid }
        );
    }

    private migrateLegacyOriginAttributes(): void {
        const originSize = this.originSize;
        if (!originSize || !this.manager.canOperate || !this.hasLegacyOriginAttributes()) return;
        this.initializeOriginAttributes(DefaultOriginCamera, originSize);
    }

    private publishMainViewCamera(camera: Camera): void {
        if (!this.originSize || !isValidCamera(camera)) return;
        if (this.hasEmptyOriginAttributes()) {
            this.initializeOriginAttributes(camera, this.originSize);
            return;
        }
        if (this.hasLegacyOriginAttributes()) {
            this.migrateLegacyOriginAttributes();
            return;
        }
        if (!this.hasValidOriginAttributes("block")) return;
        this.store.setMainViewCamera({ ...camera, id: this.manager.uid });
    }

    private applyCameraBound(cameraBound: CameraBound): void {
        this.view.setCameraBound(cameraBound);
    }

    private currentOriginCamera(): Camera | undefined {
        const camera =
            this.originCameraOperationBaseCamera ||
            this.pendingCameraAndSizeCamera ||
            this.readMainViewCamera();
        return camera ? { ...camera } : undefined;
    }

    private beginOriginLayoutSync(expectedSize?: Size): void {
        if (!this.isOriginMode) return;
        this.layoutRevision += 1;
        this.layoutSyncing = true;
        this.expectedLayoutSize = expectedSize
            ? { width: expectedSize.width, height: expectedSize.height }
            : undefined;
        if (this.originCameraCommitTimer) {
            clearTimeout(this.originCameraCommitTimer);
            this.originCameraCommitTimer = 0;
        }
        if (this.originCameraMaxCommitTimer) {
            clearTimeout(this.originCameraMaxCommitTimer);
            this.originCameraMaxCommitTimer = 0;
        }
    }

    private isExpectedLayoutReady(): boolean {
        if (!isValidSize(this.view.size)) return false;
        if (!this.expectedLayoutSize) return true;
        return (
            Math.abs(this.view.size.width - this.expectedLayoutSize.width) <= LayoutSizeEpsilon &&
            Math.abs(this.view.size.height - this.expectedLayoutSize.height) <= LayoutSizeEpsilon
        );
    }

    private tryFinishOriginLayoutSync(): void {
        if (!this.isOriginMode || !this.layoutSyncing || !this.isExpectedLayoutReady()) return;
        this.layoutSyncing = false;
        this.expectedLayoutSize = undefined;

        const operations = this.pendingOriginCameraOperations;
        const camera = operations.length
            ? this.originCameraOperationBaseCamera ||
              this.pendingCameraAndSizeCamera ||
              this.readMainViewCamera()
            : this.pendingCameraAndSizeCamera || this.readMainViewCamera();
        if (camera) {
            try {
                this.applyMainViewCamera(camera);
            } catch (error) {
                this.logIgnoredOriginCameraOperation(error);
            }
        }

        if (operations.length) {
            for (const operation of operations) {
                operation.targetCamera = undefined;
                operation.targetReferenceSize = undefined;
            }
            operations.forEach((operation, index) => {
                try {
                    this.executeOriginCameraOperation(operation, index);
                } catch (error) {
                    this.logIgnoredOriginCameraOperation(error);
                    const previousState = this.originCameraStateBeforeOperation(index);
                    operation.targetCamera = previousState?.camera;
                    operation.targetReferenceSize = previousState?.referenceSize;
                }
            });
            this.scheduleOriginCameraCommit(500);
            this.ensureOriginCameraMaxCommit();
            if (operations.length >= MaxPendingOriginCameraOperations) {
                this.commitOriginCameraOperations(true);
            }
        }
        if (this.cameraAndSizeCommitPending) this.scheduleSetCameraAndSize();
    }

    private logIgnoredOriginCameraOperation(error: unknown): void {
        try {
            this.manager.windowManger.Logger?.error(
                `[WindowManager]: ignore failed origin camera operation: ${String(error)}`
            );
        } catch (loggerError) {
            console.warn("[WindowManager]: failed to report origin camera operation", loggerError);
        }
    }

    private currentOriginCameraForApi(): Camera | undefined {
        const lastOperation =
            this.pendingOriginCameraOperations[this.pendingOriginCameraOperations.length - 1];
        if (lastOperation?.targetCamera) {
            return { ...lastOperation.targetCamera };
        }
        return this.currentOriginCamera();
    }

    public moveCameraByApi(camera: MoveCameraParams): void {
        if (
            (camera.centerX !== undefined && !Number.isFinite(camera.centerX)) ||
            (camera.centerY !== undefined && !Number.isFinite(camera.centerY)) ||
            (camera.scale !== undefined && (!Number.isFinite(camera.scale) || camera.scale <= 0))
        )
            return;
        if (
            camera.centerX === undefined &&
            camera.centerY === undefined &&
            camera.scale === undefined
        )
            return;

        const currentCamera = this.currentOriginCameraForApi();
        if (!this.layoutSyncing && currentCamera) {
            const nextCamera = this.mergeOriginCamera(currentCamera, camera);
            if (isEqual(nextCamera, currentCamera)) return;
        }
        this.queueOriginCameraOperation({
            kind: "move",
            camera: { ...camera },
            commitMode: "camera-only",
        });
    }

    public moveCameraToContainByApi(rectangle: MoveCameraToContainParams): void {
        const scalePptToFitContext = this.scalePptToFitContext;
        if (scalePptToFitContext && !scalePptToFitContext.didRequestContain) {
            this.cancelCameraAndSizeCommit();
            this.clearPendingOriginCameraOperations();
            scalePptToFitContext.didRequestContain = true;
        }
        this.queueOriginCameraOperation({
            kind: "contain",
            rectangle: { ...rectangle },
            commitMode: scalePptToFitContext ? "camera-and-size" : "camera-only",
        });
    }

    public runScalePptToFit(callback: () => void): void {
        if (!this.isOriginMode) {
            callback();
            this.setCameraAndSize();
            return;
        }

        const previousContext = this.scalePptToFitContext;
        const context: ScalePptToFitContext = { didRequestContain: false };
        let completed = false;
        this.scalePptToFitContext = context;
        try {
            callback();
            completed = true;
        } finally {
            this.scalePptToFitContext = previousContext;
            if (completed && context.didRequestContain) {
                this.scheduleSetCameraAndSize(500, {
                    preserveOriginCameraOperations: true,
                });
            }
        }
    }

    public setCameraBoundByApi(cameraBound: CameraBound): void {
        const previousCameraBound = this.cameraBound;
        const nextCameraBound = this.mergeEffectiveCameraBound(previousCameraBound, cameraBound);
        try {
            this.applyCameraBound(nextCameraBound);
            this.cameraBound = nextCameraBound;
        } catch (error) {
            this.cameraBound = previousCameraBound;
            try {
                this.applyCameraBound(previousCameraBound);
            } catch (rollbackError) {
                this.manager.windowManger.Logger?.error(
                    `[WindowManager]: failed to restore camera bound: ${String(rollbackError)}`
                );
            }
            throw error;
        }
    }

    private queueOriginCameraOperation(operation: OriginCameraOperation): void {
        if (this.cameraAndSizeCommitPending) operation.commitMode = "camera-and-size";
        if (!this.pendingOriginCameraOperations.length) {
            this.originCameraOperationBaseCamera = this.currentOriginCameraForApi();
        }
        if (this.layoutSyncing) this.compactOriginCameraOperation(operation);
        else this.pendingOriginCameraOperations.push(operation);
        this.ensureOriginCameraMaxCommit();
        this.enforceOriginCameraOperationLimit();
        if (this.layoutSyncing) return;
        const index = this.pendingOriginCameraOperations.length - 1;
        this.executeOriginCameraOperation(operation, index);
        this.scheduleOriginCameraCommit(500);
        if (this.cameraAndSizeCommitPending) {
            this.scheduleSetCameraAndSize(500, { preserveOriginCameraOperations: true });
        }
        if (this.pendingOriginCameraOperations.length >= MaxPendingOriginCameraOperations) {
            this.commitOriginCameraOperations(true);
        }
    }

    private executeOriginCameraOperation(operation: OriginCameraOperation, index: number): void {
        if (this.layoutSyncing) return;
        const referenceSize = this.readMainViewReferenceSize();
        if (!referenceSize) return;
        if (operation.kind === "move") {
            const currentCamera = this.resolveOriginCameraBeforeOperation(index);
            if (!currentCamera) return;
            const targetCamera = this.mergeOriginCamera(currentCamera, operation.camera);
            if (!isValidCamera(targetCamera)) return;
            if (!isEqual(targetCamera, currentCamera)) {
                operation.targetCamera = this.applyMainViewCamera(
                    targetCamera,
                    operation.camera.animationMode ?? AnimationMode.Continuous,
                    referenceSize
                );
            } else {
                operation.targetCamera = currentCamera;
            }
            if (operation.targetCamera) {
                operation.targetReferenceSize = { ...referenceSize };
            }
        } else if (operation.kind === "contain") {
            const targetCamera = mainViewCameraToContain(operation.rectangle, referenceSize);
            if (targetCamera) {
                operation.targetCamera = this.applyMainViewCamera(
                    targetCamera,
                    operation.rectangle.animationMode ?? AnimationMode.Continuous,
                    referenceSize
                );
                if (operation.targetCamera) {
                    operation.targetReferenceSize = { ...referenceSize };
                }
            }
        }
    }

    private resolveOriginCameraBeforeOperation(index: number): Camera | undefined {
        const previousState = this.originCameraStateBeforeOperation(index);
        if (!previousState) return undefined;
        this.applyMainViewCamera(
            previousState.camera,
            AnimationMode.Immediately,
            previousState.referenceSize
        );
        return { ...previousState.camera };
    }

    private originCameraStateBeforeOperation(
        index: number
    ): { camera: Camera; referenceSize?: Size } | undefined {
        for (let operationIndex = index - 1; operationIndex >= 0; operationIndex -= 1) {
            const operation = this.pendingOriginCameraOperations[operationIndex];
            if (operation.targetCamera) {
                return {
                    camera: { ...operation.targetCamera },
                    referenceSize: operation.targetReferenceSize
                        ? { ...operation.targetReferenceSize }
                        : undefined,
                };
            }
        }
        const camera = this.currentOriginCamera();
        if (!camera) return undefined;
        const referenceSize = this.readMainViewReferenceSize();
        return {
            camera,
            referenceSize: referenceSize ? { ...referenceSize } : undefined,
        };
    }

    private compactOriginCameraOperation(operation: OriginCameraOperation): void {
        const lastOperation =
            this.pendingOriginCameraOperations[this.pendingOriginCameraOperations.length - 1];
        if (lastOperation?.kind === "move" && operation.kind === "move") {
            lastOperation.camera = {
                ...lastOperation.camera,
                ...operation.camera,
                animationMode: operation.camera.animationMode ?? AnimationMode.Continuous,
            };
            if (operation.commitMode === "camera-and-size") {
                lastOperation.commitMode = "camera-and-size";
            }
            lastOperation.targetCamera = undefined;
            return;
        }
        if (lastOperation?.kind === "contain" && operation.kind === "contain") {
            this.pendingOriginCameraOperations[this.pendingOriginCameraOperations.length - 1] =
                operation;
            return;
        }
        this.pendingOriginCameraOperations.push(operation);
    }

    private enforceOriginCameraOperationLimit(): void {
        if (this.pendingOriginCameraOperations.length <= MaxPendingOriginCameraOperations) return;
        const operations = this.pendingOriginCameraOperations;
        let lastContainIndex = -1;
        for (let index = operations.length - 1; index >= 0; index -= 1) {
            if (operations[index].kind === "contain") {
                lastContainIndex = index;
                break;
            }
        }

        const compactedOperations: OriginCameraOperation[] = [];
        if (lastContainIndex >= 0) {
            const containOperation = operations[lastContainIndex];
            if (containOperation.kind === "contain") {
                compactedOperations.push({
                    kind: "contain",
                    rectangle: { ...containOperation.rectangle },
                    commitMode: containOperation.commitMode,
                });
            }
        }

        const mergedMove: MoveCameraParams = {};
        let hasMove = false;
        let mergedMoveCommitMode: OriginCameraCommitMode = "camera-only";
        for (let index = Math.max(0, lastContainIndex); index < operations.length; index += 1) {
            const operation = operations[index];
            if (operation.kind !== "move") continue;
            if (operation.commitMode === "camera-and-size") {
                mergedMoveCommitMode = "camera-and-size";
            }
            if (operation.camera.centerX !== undefined) {
                mergedMove.centerX = operation.camera.centerX;
                hasMove = true;
            }
            if (operation.camera.centerY !== undefined) {
                mergedMove.centerY = operation.camera.centerY;
                hasMove = true;
            }
            if (operation.camera.scale !== undefined) {
                mergedMove.scale = operation.camera.scale;
                hasMove = true;
            }
            mergedMove.animationMode = operation.camera.animationMode ?? AnimationMode.Continuous;
        }
        if (hasMove) {
            compactedOperations.push({
                kind: "move",
                camera: mergedMove,
                commitMode: mergedMoveCommitMode,
            });
        }

        this.pendingOriginCameraOperations = compactedOperations;
        this.manager.windowManger.Logger?.warn(
            `[WindowManager]: compact origin camera operations after exceeding ${MaxPendingOriginCameraOperations} pending operations`
        );
    }

    private mergeEffectiveCameraBound(current: CameraBound, update: CameraBound): CameraBound {
        // White SDK patches geometry but clears omitted content modes. Keep the effective
        // value so a replacement View can restore the same local CameraBound after rebind.
        return {
            damping: update.damping ?? current.damping,
            centerX: update.centerX ?? current.centerX,
            centerY: update.centerY ?? current.centerY,
            width: update.width ?? current.width,
            height: update.height ?? current.height,
            maxContentMode: update.maxContentMode,
            minContentMode: update.minContentMode,
        };
    }

    private mergeOriginCamera(camera: Camera, update: MoveCameraParams): Camera {
        return {
            centerX: update.centerX ?? camera.centerX,
            centerY: update.centerY ?? camera.centerY,
            scale: update.scale ?? camera.scale,
        };
    }

    private clearPendingOriginCameraOperations(): void {
        this.pendingOriginCameraOperations = [];
        this.originCameraOperationBaseCamera = undefined;
        if (this.originCameraCommitTimer) {
            clearTimeout(this.originCameraCommitTimer);
            this.originCameraCommitTimer = 0;
        }
        if (this.originCameraMaxCommitTimer) {
            clearTimeout(this.originCameraMaxCommitTimer);
            this.originCameraMaxCommitTimer = 0;
        }
    }

    private scheduleOriginCameraCommit(delay: number): void {
        if (!this.pendingOriginCameraOperations.length || this.layoutSyncing) return;
        if (this.originCameraCommitTimer) clearTimeout(this.originCameraCommitTimer);
        const revision = this.layoutRevision;
        this.originCameraCommitTimer = window.setTimeout(() => {
            this.originCameraCommitTimer = 0;
            if (revision !== this.layoutRevision || this.layoutSyncing) return;
            this.commitOriginCameraOperations(false);
        }, delay);
    }

    private ensureOriginCameraMaxCommit(): void {
        if (
            this.layoutSyncing ||
            this.originCameraMaxCommitTimer ||
            !this.pendingOriginCameraOperations.length
        )
            return;
        this.originCameraMaxCommitTimer = window.setTimeout(() => {
            this.originCameraMaxCommitTimer = 0;
            if (this.layoutSyncing) return;
            this.commitOriginCameraOperations(true);
        }, OriginCameraMaxCommitDelay);
    }

    private commitOriginCameraOperations(settleLastCameraOperation: boolean): void {
        if (!this.pendingOriginCameraOperations.length || this.layoutSyncing) return;
        try {
            if (settleLastCameraOperation) {
                this.resolveOriginCameraBeforeOperation(this.pendingOriginCameraOperations.length);
            }
            const lastOperation =
                this.pendingOriginCameraOperations[this.pendingOriginCameraOperations.length - 1];
            if (
                lastOperation.targetCamera &&
                (lastOperation.commitMode === "camera-and-size" || this.cameraAndSizeCommitPending)
            ) {
                this.pendingCameraAndSizeCamera = { ...lastOperation.targetCamera };
                this.pendingCameraAndSizeReferenceSize = lastOperation.targetReferenceSize
                    ? { ...lastOperation.targetReferenceSize }
                    : this.readMainViewReferenceSize();
            }
            if (
                lastOperation.targetCamera &&
                lastOperation.commitMode !== "camera-and-size" &&
                !this.cameraAndSizeCommitPending
            ) {
                this.publishMainViewCamera(lastOperation.targetCamera);
            }
        } finally {
            this.pendingOriginCameraOperations = [];
            this.originCameraOperationBaseCamera = undefined;
            if (this.originCameraCommitTimer) {
                clearTimeout(this.originCameraCommitTimer);
                this.originCameraCommitTimer = 0;
            }
            if (this.originCameraMaxCommitTimer) {
                clearTimeout(this.originCameraMaxCommitTimer);
                this.originCameraMaxCommitTimer = 0;
            }
        }
    }

    private moveCameraSizeByAttributes() {
        if (this.isOriginMode) {
            const camera = this.currentOriginCameraForApi();
            if (camera) this.applyMainViewCamera(camera);
            return;
        }
        this.moveCameraToContian(this.mainViewSize);
        this.moveCamera(this.mainViewCamera);
    }

    private onWrapperRectChange = (payload: { width: number; height: number; origin?: string }) => {
        this.beginOriginLayoutSync(payload);
        this.pendingWrapperRectChange = payload;
        if (this.wrapperRectWorkaroundFrame) {
            cancelAnimationFrame(this.wrapperRectWorkaroundFrame);
        }
        this.wrapperRectWorkaroundFrame = requestAnimationFrame(this.runWrapperRectWorkaround);
    };

    private runWrapperRectWorkaround = () => {
        this.wrapperRectWorkaroundFrame = 0;
        const payload = this.pendingWrapperRectChange;
        const element = this.mainView.divElement;
        this.pendingWrapperRectChange = undefined;
        if (!payload) return;
        if (!element) {
            this.tryFinishOriginLayoutSync();
            return;
        }

        const rect = element.getBoundingClientRect();
        const observedSize = { width: rect.width, height: rect.height };
        const wrapperMatchesDom =
            Math.abs(payload.width - observedSize.width) <= 0.5 &&
            Math.abs(payload.height - observedSize.height) <= 0.5;
        const viewIsStale =
            Math.abs(this.mainView.size.width - observedSize.width) > 0.5 ||
            Math.abs(this.mainView.size.height - observedSize.height) > 0.5;

        if (wrapperMatchesDom && viewIsStale) {
            this.forceSyncMainViewDivElement(
                `wrapperRectChange:${payload.origin || "unknown"}`,
                observedSize,
                element
            );
        }
        this.tryFinishOriginLayoutSync();
    };

    private forceSyncMainViewDivElement(
        reason: string,
        observedSize: Pick<Size, "width" | "height">,
        element: HTMLDivElement
    ) {
        const { width: viewWidth, height: viewHeight } = this.mainView.size;
        const targetElement = element;
        if (
            Math.abs(viewWidth - observedSize.width) <= 0.5 &&
            Math.abs(viewHeight - observedSize.height) <= 0.5
        ) {
            return;
        }
        if (this.isForcingMainViewDivElement) {
            console.log(
                "[window-manager] skipForceSyncMainViewDivElement " +
                    JSON.stringify({
                        reason,
                        observedSize,
                        viewSize: this.mainView.size,
                    })
            );
            return;
        }
        this.isForcingMainViewDivElement = true;
        try {
            const mainView = this.mainView as View & { screen?: MainViewScreenLike };
            const screen = mainView.screen;
            const resizeObserver = screen?.resizeObserver;
            if (typeof screen?.refreshSize === "function") {
                console.log(
                    "[window-manager] forceSyncMainViewDivElement observerReset " +
                        JSON.stringify({
                            reason,
                            viewSize: this.mainView.size,
                            observedSize,
                        })
                );
                // Reset the observer queue so we sync against the current DOM box,
                // not a stale ResizeObserver entry from a rapid resize burst.
                resizeObserver?.disconnect?.();
                screen.refreshSize(observedSize.width, observedSize.height);
                resizeObserver?.observe?.(element);
            }
        } finally {
            queueMicrotask(() => {
                const rect = targetElement.getBoundingClientRect();
                console.log(
                    "[window-manager] forceSyncMainViewDivElementResult " +
                        JSON.stringify({
                            reason,
                            viewSize: this.mainView.size,
                            rect: { width: rect.width, height: rect.height },
                        })
                );
                this.isForcingMainViewDivElement = false;
            });
        }
    }

    public start() {
        console.log("[window-manager] start attributes size:" + JSON.stringify(this.mainViewSize));
        this.sizeChangeHandler(this.mainViewSize);
        if (this.started) return;
        this.addCameraListener();
        this.addCameraReaction();
        if (this.manager.room) this.syncMainView(this.manager.room);
        this.started = true;
        if (this.mainView.focusScenePath) {
            this.manager.windowManger.onMainViewScenePathChangeHandler(
                this.mainView.focusScenePath
            );
        }
        console.log(
            "[window-manager] start end mainView size:" + JSON.stringify(this.mainView.size)
        );
    }

    public addCameraReaction = () => {
        this.manager.refresher.add(Fields.MainViewCamera, this.cameraReaction);
    };

    public setCameraAndSize(): void {
        if (this.isOriginMode) {
            if (this.layoutSyncing) return;
            if (this.cameraAndSizeCommitPending && this.pendingOriginCameraOperations.length) {
                this.commitOriginCameraOperations(false);
            }
            const mainViewSize = { ...this.view.size };
            if (!isValidSize(mainViewSize)) return;
            const mainViewCamera = this.cameraForActivePairSnapshot(mainViewSize);
            if (!mainViewCamera) return;
            let committed = false;
            if (this.hasEmptyOriginAttributes()) {
                this.initializeOriginAttributes(mainViewCamera, mainViewSize);
                committed = true;
            } else if (this.hasValidOriginAttributes("block")) {
                this.store.setMainViewCameraAndSize(
                    { ...mainViewCamera, id: this.manager.uid },
                    { ...mainViewSize, id: this.manager.uid }
                );
                committed = true;
            }
            if (committed) {
                if (this.cameraAndSizeCommitTimer) {
                    clearTimeout(this.cameraAndSizeCommitTimer);
                    this.cameraAndSizeCommitTimer = 0;
                }
                this.cameraAndSizeCommitPending = false;
                this.pendingCameraAndSizeCamera = undefined;
                this.pendingCameraAndSizeReferenceSize = undefined;
            }
            return;
        }
        const camera = { ...this.mainView.camera, id: this.manager.uid };
        const size = { ...this.mainView.size, id: this.manager.uid };
        this.store.setMainViewCameraAndSize(camera, size);
    }

    private cameraForActivePairSnapshot(mainViewSize: Size): Camera | undefined {
        if (this.cameraAndSizeCommitPending && this.pendingCameraAndSizeCamera) {
            if (!this.pendingCameraAndSizeReferenceSize) return undefined;
            return mainViewCameraToLocal(
                this.pendingCameraAndSizeCamera,
                this.pendingCameraAndSizeReferenceSize,
                mainViewSize
            );
        }
        return isValidCamera(this.view.camera) ? { ...this.view.camera } : undefined;
    }

    public scheduleSetCameraAndSize(delay = 500, options: CameraAndSizeCommitOptions = {}): void {
        if (!this.isOriginMode) {
            this.setCameraAndSize();
            return;
        }
        if (!this.cameraAndSizeCommitPending && !options.preserveOriginCameraOperations) {
            this.clearPendingOriginCameraOperations();
            this.pendingCameraAndSizeCamera = undefined;
            this.pendingCameraAndSizeReferenceSize = undefined;
        }
        this.cameraAndSizeCommitPending = true;
        if (this.cameraAndSizeCommitTimer) clearTimeout(this.cameraAndSizeCommitTimer);
        this.cameraAndSizeCommitTimer = window.setTimeout(() => {
            this.cameraAndSizeCommitTimer = 0;
            if (this.layoutSyncing) return;
            this.setCameraAndSize();
        }, delay);
    }

    private cancelCameraAndSizeCommit(): void {
        if (this.cameraAndSizeCommitTimer) {
            clearTimeout(this.cameraAndSizeCommitTimer);
            this.cameraAndSizeCommitTimer = 0;
        }
        this.cameraAndSizeCommitPending = false;
        this.pendingCameraAndSizeCamera = undefined;
        this.pendingCameraAndSizeReferenceSize = undefined;
    }

    public fitOriginSizeAndCamera(): void {
        const originSize = this.originSize;
        if (!originSize) return;
        this.clearPendingOriginCameraOperations();
        this.cancelCameraAndSizeCommit();
        const originCamera = { ...DefaultOriginCamera };
        if (this.hasEmptyOriginAttributes()) {
            this.initializeOriginAttributes(originCamera, originSize);
        } else {
            if (!this.hasValidOriginAttributes("block", false)) return;
            this.store.setMainViewCameraAndSize(
                { ...originCamera, id: this.manager.uid },
                { ...originSize, id: this.manager.uid }
            );
        }
        const localCamera = mainViewCameraToLocal(originCamera, originSize, this.view.size);
        if (localCamera) {
            this.view.moveCamera({ ...localCamera, animationMode: AnimationMode.Immediately });
        }
    }

    private scheduleMainViewStateLog(): void {
        if (!this.manager.Logger) return;
        if (this.mainViewStateLogTimer != null) clearTimeout(this.mainViewStateLogTimer);
        this.mainViewStateLogTimer = setTimeout(this.flushMainViewStateLog, ROOM_LOG_DEBOUNCE_MIN);
    }

    private flushMainViewStateLog = (): void => {
        this.mainViewStateLogTimer = undefined;
        const logger = this.manager.Logger;
        if (!logger) return;

        const visualViewport = window.visualViewport;
        const mainViewRect = this.view.divElement?.getBoundingClientRect();
        logger.info(
            `[WindowManager][mainViewState]: ${JSON.stringify({
                mode: this.isOriginMode ? "origin" : "legacy",
                attributeCamera: this.mainViewCamera,
                attributeSize: this.mainViewSize,
                coordinateVersion: this.mainViewCameraCoordinateVersion,
                configuredOriginSize: this.originSize,
                viewCamera: this.view.camera,
                viewSize: this.view.size,
                viewDOMSize: mainViewRect
                    ? { width: mainViewRect.width, height: mainViewRect.height }
                    : undefined,
                focusScenePath: this.view.focusScenePath,
                outerViewport: { width: window.outerWidth, height: window.outerHeight },
                visualViewport: visualViewport
                    ? {
                          width: visualViewport.width,
                          height: visualViewport.height,
                          offsetLeft: visualViewport.offsetLeft,
                          offsetTop: visualViewport.offsetTop,
                          scale: visualViewport.scale,
                      }
                    : undefined,
            })}`
        );
    };

    private cameraReaction = () => {
        if (!this.isOriginMode) {
            return reaction(
                () => this.mainViewCamera,
                (camera: MainViewCamera | undefined) => {
                    const attributeSize = this.mainViewSize;
                    if (camera && camera.id !== this.manager.uid) {
                        this.moveCameraToContian(attributeSize);
                        this.moveCamera(camera);
                    }
                    this.scheduleMainViewStateLog();
                },
                { fireImmediately: true }
            );
        }
        return reaction(
            () => {
                const camera = this.mainViewCamera;
                const size = this.mainViewSize;
                return {
                    cameraCenterX: camera?.centerX,
                    cameraCenterY: camera?.centerY,
                    cameraScale: camera?.scale,
                    cameraId: camera?.id,
                    sizeWidth: size?.width,
                    sizeHeight: size?.height,
                    sizeId: size?.id,
                    version: this.mainViewCameraCoordinateVersion,
                };
            },
            () => {
                const camera = this.mainViewCamera;
                if (camera && camera.id !== this.manager.uid) {
                    const mainViewCamera = this.currentOriginCameraForApi();
                    if (mainViewCamera && !this.layoutSyncing) {
                        this.applyMainViewCamera(mainViewCamera);
                    }
                }
                this.scheduleMainViewStateLog();
            },
            { fireImmediately: true, equals: isEqual }
        );
    };

    public sizeChangeHandler = debounce((size: Size) => {
        if (this.isOriginMode) {
            const camera = this.currentOriginCameraForApi();
            if (camera && !this.layoutSyncing && !this.pendingOriginCameraOperations.length) {
                this.applyMainViewCamera(camera);
            }
            return;
        }
        if (size) {
            this.moveCameraToContian(size);
            this.moveCamera(this.mainViewCamera);
            console.log(
                "[window-manager] sizeChangeHandler current size and camera" +
                    JSON.stringify(size) +
                    JSON.stringify(this.mainViewCamera) +
                    JSON.stringify(this.mainView.camera) +
                    JSON.stringify(this.mainView.size)
            );
        }
        this.ensureMainViewSize();
    }, 30);

    public onUpdateContainerSizeRatio = () => {
        this.beginOriginLayoutSync();
        const size = this.store.getMainViewSize();
        console.log("[window-manager] onUpdateContainerSizeRatio  " + JSON.stringify(size));
        this.sizeChangeHandler(size);
    };

    public get view(): View {
        return this.mainView;
    }

    public get cameraState() {
        return { ...this.view.camera, ...this.view.size };
    }

    public getRelativeScale(): number | undefined {
        if (this.isOriginMode) {
            const referenceSize = this.readMainViewReferenceSize();
            const camera =
                referenceSize &&
                localCameraToMainView(this.view.camera, referenceSize, this.view.size);
            const scale = camera?.scale;
            return typeof scale === "number" && Number.isFinite(scale) && scale > 0
                ? scale
                : undefined;
        }
        if (!this.scale || !Number.isFinite(this.scale) || this.scale <= 0) return undefined;
        const relativeScale = this.view.camera.scale / this.scale;
        return Number.isFinite(relativeScale) && relativeScale > 0 ? relativeScale : undefined;
    }

    public toLocalScale(relativeScale: number): number | undefined {
        if (!Number.isFinite(relativeScale) || relativeScale <= 0) return undefined;
        if (this.isOriginMode) return relativeScale;
        if (!this.scale || !Number.isFinite(this.scale) || this.scale <= 0) return undefined;
        return this.scale * relativeScale;
    }

    public createMainView(): View {
        const mainView = createView(this.manager.displayer);
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(mainView, mainViewScenePath);
        }
        return mainView;
    }

    public onReconnect(): void {
        if (this.didRelease) {
            this.rebind();
        } else {
            const mainViewScenePath = this.store.getMainViewScenePath();
            this.setFocusScenePath(mainViewScenePath);
        }
    }

    public setFocusScenePath(path: string | undefined) {
        if (path) {
            return setViewFocusScenePath(this.view, path);
        }
    }

    public rebind(): void {
        this.beginOriginLayoutSync();
        const divElement = this.mainView.divElement;
        const disableCameraTransform = this.mainView.disableCameraTransform;
        this.stop({ preserveOriginCameraOperations: true });
        if (!this.didRelease) {
            this.mainView.release();
        }
        this.removeMainViewListener();
        this.mainView = this.createMainView();
        this.mainView.disableCameraTransform = disableCameraTransform;
        this.applyCameraBound({ ...this.cameraBound });
        this.mainView.divElement = divElement;
        this.addMainViewListener();
        this.start();
        this.tryFinishOriginLayoutSync();
        callbacks.emit("onMainViewRebind", this.mainView);
    }

    private onCameraUpdatedByDevice = (camera: Camera) => {
        if (this.viewMode === ViewMode.Follower) return;
        if (this.isOriginMode) {
            const referenceSize = this.readMainViewReferenceSize();
            if (this.layoutSyncing || !referenceSize) return;
            const mainViewCamera = localCameraToMainView(camera, referenceSize, this.view.size);
            if (mainViewCamera) this.publishMainViewCamera(mainViewCamera);
            return;
        }
        this.store.setMainViewCamera({ ...camera, id: this.manager.uid });
        if (!isEqual(this.mainViewSize, { ...this.mainView.size, id: this.manager.uid })) {
            this.setMainViewSize(this.view.size);
        }
    };

    public addMainViewListener(): void {
        if (this.mainViewIsAddListener) return;
        if (this.view.divElement) {
            this.view.divElement.addEventListener("click", this.mainViewClickListener);
            this.view.divElement.addEventListener("touchend", this.mainViewClickListener);
            this.mainViewIsAddListener = true;
        }
    }

    public removeMainViewListener(): void {
        if (this.view.divElement) {
            this.view.divElement.removeEventListener("click", this.mainViewClickListener);
            this.view.divElement.removeEventListener("touchend", this.mainViewClickListener);
        }
        this.mainViewIsAddListener = false;
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    };

    public async mainViewClickHandler(): Promise<void> {
        if (!this.manager.canOperate) return;
        this.store.cleanFocus();
        this.manager.boxManager?.blurAllBox();
    }

    public setMainViewSize = debounce((size: Size) => {
        if (this.isOriginMode) return;
        this.store.setMainViewSize({ ...size, id: this.manager.uid });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        this.view.callbacks.on("onCameraUpdated", this.onCameraUpdated);
        this.view.callbacks.on("onSizeUpdated", this.onSizeUpdated);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        this.view.callbacks.off("onCameraUpdated", this.onCameraUpdated);
        this.view.callbacks.off("onSizeUpdated", this.onSizeUpdated);
    }

    private _syncMainViewTimer = 0;
    private handleCameraOrSizeUpdated = () => {
        callbacks.emit("cameraStateChange", this.cameraState);
        // sdk >= 2.16.43 的 syncMainView() 可以写入当前 main view 的 camera, 以修复复制粘贴元素的位置
        // 注意到这个操作会发送信令，应当避免频繁调用
        if (this.manager.room && (this.manager.room as any).syncMainView) {
            clearTimeout(this._syncMainViewTimer);
            this._syncMainViewTimer = setTimeout(this.syncMainView, 100, this.manager.room);
        }
        this.ensureMainViewSize();
    };

    private onCameraUpdated = (_camera: Camera) => {
        if (this.cameraAndSizeCommitPending) this.scheduleSetCameraAndSize();
        if (
            this.isOriginMode &&
            this.pendingOriginCameraOperations.length > 0 &&
            !this.layoutSyncing
        ) {
            this.scheduleOriginCameraCommit(100);
        }
        this.handleCameraOrSizeUpdated();
        this.scheduleMainViewStateLog();
    };

    private onSizeUpdated = (_size: Size) => {
        if (this.cameraAndSizeCommitPending) this.scheduleSetCameraAndSize();
        if (this.isOriginMode) {
            if (!this.layoutSyncing) this.beginOriginLayoutSync();
            this.tryFinishOriginLayoutSync();
        }
        this.handleCameraOrSizeUpdated();
        this.scheduleMainViewStateLog();
    };

    private ensureMainViewSize() {
        if (this.isOriginMode) return;
        if (
            (!this.mainViewSize ||
                this.mainViewSize.width === 0 ||
                this.mainViewSize.height === 0) &&
            this.mainView.size.width > 0 &&
            this.mainView.size.height > 0
        ) {
            this.setMainViewSize(this.mainView.size);
        }
    }

    private syncMainView = (room: Room) => {
        if (room.isWritable) {
            room.syncMainView(this.mainView);
        }
    };

    public moveCameraToContian(size: Size): void {
        if (!isEmpty(size)) {
            this.view.moveCameraToContain({
                width: size.width,
                height: size.height,
                originX: -size.width / 2,
                originY: -size.height / 2,
                animationMode: AnimationMode.Immediately,
            });
            this.scale = this.view.camera.scale;
        }
    }

    public moveCamera(camera: Camera): void {
        if (!isEmpty(camera)) {
            if (isEqual(camera, this.view.camera)) return;
            const { centerX, centerY, scale } = camera;
            const needScale = scale * (this.scale || 1);
            this.view.moveCamera({
                centerX: centerX,
                centerY: centerY,
                scale: needScale,
                animationMode: AnimationMode.Immediately,
            });
        }
    }

    public stop(options: { preserveOriginCameraOperations?: boolean } = {}) {
        if (this.cameraAndSizeCommitTimer) {
            clearTimeout(this.cameraAndSizeCommitTimer);
            this.cameraAndSizeCommitTimer = 0;
        }
        if (this.originCameraCommitTimer) {
            clearTimeout(this.originCameraCommitTimer);
            this.originCameraCommitTimer = 0;
        }
        if (this.originCameraMaxCommitTimer) {
            clearTimeout(this.originCameraMaxCommitTimer);
            this.originCameraMaxCommitTimer = 0;
        }
        if (!options.preserveOriginCameraOperations) {
            this.cameraAndSizeCommitPending = false;
            this.pendingCameraAndSizeCamera = undefined;
            this.pendingCameraAndSizeReferenceSize = undefined;
            this.pendingOriginCameraOperations = [];
            this.originCameraOperationBaseCamera = undefined;
            this.layoutSyncing = false;
            this.expectedLayoutSize = undefined;
        }
        this.removeCameraListener();
        this.manager.refresher.remove(Fields.MainViewCamera);
        this.manager.refresher.remove(Fields.MainViewSize);
        this.started = false;
    }

    public setViewMode = (mode: ViewMode) => {
        this.viewMode = mode;
    };

    public destroy() {
        console.log("[window-manager] destroy  ");
        if (this.wrapperRectWorkaroundFrame) {
            cancelAnimationFrame(this.wrapperRectWorkaroundFrame);
            this.wrapperRectWorkaroundFrame = 0;
        }
        if (this.originCameraCommitTimer) {
            clearTimeout(this.originCameraCommitTimer);
            this.originCameraCommitTimer = 0;
        }
        if (this.originCameraMaxCommitTimer) {
            clearTimeout(this.originCameraMaxCommitTimer);
            this.originCameraMaxCommitTimer = 0;
        }
        if (this.cameraAndSizeCommitTimer) {
            clearTimeout(this.cameraAndSizeCommitTimer);
            this.cameraAndSizeCommitTimer = 0;
        }
        this.cameraAndSizeCommitPending = false;
        this.pendingCameraAndSizeCamera = undefined;
        this.pendingCameraAndSizeReferenceSize = undefined;
        this.pendingOriginCameraOperations = [];
        this.originCameraOperationBaseCamera = undefined;
        if (this.mainViewStateLogTimer != null) {
            clearTimeout(this.mainViewStateLogTimer);
            this.mainViewStateLogTimer = undefined;
        }
        this.removeMainViewListener();
        this.stop();
        this.sideEffectManager.flushAll();
    }
}
