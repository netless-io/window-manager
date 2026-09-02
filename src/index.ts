import pRetry from "p-retry";
import { AppManager } from "./AppManager";
import { appRegister } from "./Register";
import { callbacks } from "./callback";
import { checkVersion, createInvisiblePlugin, setupWrapper } from "./Helper";
import { ContainerResizeObserver } from "./ContainerResizeObserver";
import { createBoxManager } from "./BoxManager";
import { CursorManager } from "./Cursor";
import { DEFAULT_CONTAINER_RATIO, Events, INIT_DIR, ROOT_DIR } from "./constants";
import { internalEmitter } from "./InternalEmitter";
import { Fields } from "./AttributesDelegate";
import { initDb } from "./Register/storage";
import { InvisiblePlugin, isPlayer, isRoom, RoomPhase, ViewMode } from "white-web-sdk";
import { isEqual, isNull, isObject, omit, isNumber } from "lodash";
import { ArgusLog, createManagedRoomLogger, log } from "./Utils/log";
import { PageStateImpl } from "./PageState";
import { ReconnectRefresher } from "./ReconnectRefresher";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { BuiltinApps, setupBuiltin } from "./BuiltinApps";
import type { BuiltinAppOptions } from "./BuiltinApps";
import "video.js/dist/video-js.css";
import "./style.css";
import "@netless/telebox-insider/dist/style.css";
import {
    addEmitterOnceListener,
    ensureValidScenePath,
    entireScenes,
    isValidScenePath,
    putScenes,
    wait,
} from "./Utils/Common";
import type { BoxManager } from "./BoxManager";
import type { TELE_BOX_STATE } from "./BoxManager";
import * as Errors from "./Utils/error";
import type { Apps, Position } from "./AttributesDelegate";
import type {
    Displayer,
    SceneDefinition,
    View,
    Room,
    InvisiblePluginContext,
    Camera,
    AnimationMode,
    CameraBound,
    Point,
    Rectangle,
    CameraState,
    Player,
    ImageInformation,
    SceneState,
    Logger,
    Size,
} from "white-web-sdk";
import type { AppListeners } from "./AppListener";
import type { ApplianceIcons, NetlessApp, RegisterParams } from "./typings";
import type {
    NotMinimizedBoxState,
    TeleBoxColorScheme,
    TeleBoxState,
} from "@netless/telebox-insider";
import type { AppProxy } from "./App";
import type { PublicEvent } from "./callback";
export type {
    PageEvent,
    PageEventTarget,
    PageEventOptions,
    PageStateOptions,
    UnifiedPageState,
    UnifiedPageStateFailure,
    UnifiedPageStateObservation,
    UnifiedPageStateChange,
} from "./UnifiedPageControl";
export type { AppLogger, AppLoggerOptions } from "./Utils/log";
import { executeAppPageCommand, UnifiedPageControlTracker } from "./UnifiedPageControl";
import type {
    PageEvent,
    PageEventOptions,
    PageEventTarget,
    PageStateOptions,
    PresentationPageController,
    SlidePageController,
    UnifiedPageState,
    UnifiedPageStateChange,
} from "./UnifiedPageControl";
import type Emittery from "emittery";
import type { PageController, AddPageParams, PageState } from "./Page";
import { boxEmitter } from "./BoxEmitter";
import { IframeBridge } from "./View/IframeBridge";
import type { ExtendPluginInstance } from "./ExtendPluginManager";
import { ExtendPluginManager } from "./ExtendPluginManager";
import { getExtendClass } from "./Utils/extendClass";
import type { ExtendClass } from "./Utils/extendClass";
import { resolveAppOptions as mergeAppOptions } from "./Utils/resolveAppOptions";
import {
    MAIN_VIEW_CAMERA_COORDINATE_VERSION,
    isSameOriginSize,
    isLegacyMainViewCameraContract,
    isValidCamera,
    isValidSize,
    normalizeOriginSize,
} from "./View/MainViewCameraTransform";

export * from "./utils/extendClass";

export type WindowMangerAttributes = {
    modelValue?: string;
    boxState: TELE_BOX_STATE;
    maximized?: boolean;
    minimized?: boolean;
    [key: string]: any;
};

export type apps = {
    [key: string]: NetlessApp;
};

export type AddAppOptions = {
    scenePath?: string;
    title?: string;
    scenes?: SceneDefinition[];
};

export type setAppOptions = AddAppOptions & { appOptions?: any };

export type DocsEvent =
    | "prevPage"
    | "nextPage"
    | "prevStep"
    | "nextStep"
    | "jumpToPage"
    | "scalePage";

export type DocsEventOptions = {
    /** If provided, will dispatch to the specific app. Default to the focused app. */
    appId?: string;
    /** Used by `jumpToPage` event, range from 1 to total pages count. */
    page?: number;
    /** Used by `scalePage` event. Range from 1 to 4, decimals allowed. `1` means default fitted size. */
    scale?: number;
};

const SlideAppKind = "Slide" as const;
const PresentationAppKind = BuiltinApps.Presentation as "Presentation";
const MinDocsPageScale = 1;
const MaxDocsPageScale = 4;

function isValidDocsPageScale(scale: unknown): scale is number {
    return (
        typeof scale === "number" &&
        Number.isFinite(scale) &&
        scale >= MinDocsPageScale &&
        scale <= MaxDocsPageScale
    );
}

export type AddAppParams<TAttributes = any> = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: TAttributes;
    // 强制置顶
    forceTop?: boolean;
    // 强制正常窗口
    forceNormal?: boolean;
    // 是否可以在内容区域拖动
    isDragContent?: boolean;
};

export type BaseInsertParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
    isDynamicPPT?: boolean;
    // 强制置顶
    forceTop?: boolean;
    // 强制正常窗口
    forceNormal?: boolean;
    // 是否可以在内容区域拖动
    isDragContent?: boolean;
};

export type AppSyncAttributes = {
    kind: string;
    src?: string;
    options: any;
    state?: any;
    isDynamicPPT?: boolean;
    fullPath?: string;
    createdAt?: number;
    // 强制置顶
    forceTop?: boolean;
    // 强制正常窗口
    forceNormal?: boolean;
    // 是否可以在内容区域拖动
    isDragContent?: boolean;
};

export type AppInitState = {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    focus?: boolean;
    maximized?: boolean;
    minimized?: boolean;
    sceneIndex?: number;
    /** 所有box的基本状态 */
    boxState?: TeleBoxState; // 兼容旧版 telebox
    zIndex?: number;
    /** 扩展版本,单个box的状态 */
    boxStatus?: TeleBoxState;
    /** 上次非最小化窗口状态 */
    lastNotMinimizedBoxStatus?: NotMinimizedBoxState;
    // 强制置顶
    forceTop?: boolean;
    // 强制正常窗口
    forceNormal?: boolean;
    // 是否可以在内容区域拖动
    isDragContent?: boolean;
};

export type CursorMovePayload = { uid: string; state?: "leave"; position: Position };

export type CursorOptions = {
    /**
     * If `"custom"`, it will render the pencil / eraser cursor as a circle and shapes cursor as a cross.
     *
     * @default "default"
     */
    style?: "default" | "custom";
};

export type MountParams = {
    room: Room | Player;
    container?: HTMLElement;
    /** mainView 固定原始尺寸，用于建立和恢复统一的 camera 基准。 */
    originSize?: Size;
    /** 白板高宽比例, 默认为 9 / 16 */
    containerSizeRatio?: number;
    /** @deprecated 显示 PS 透明背景，默认 true */
    chessboard?: boolean;
    collectorContainer?: HTMLElement;
    collectorStyles?: Partial<CSSStyleDeclaration>;
    overwriteStyles?: string;
    cursor?: boolean;
    cursorOptions?: CursorOptions;
    debug?: boolean;
    disableCameraTransform?: boolean;
    prefersColorScheme?: TeleBoxColorScheme;
    applianceIcons?: ApplianceIcons;
    fullscreen?: boolean;
    polling?: boolean;
    /** 是否支持 appliance plugin */
    supportAppliancePlugin?: boolean;
    /** 是否使用 boxesStatus 状态管理窗口 */
    useBoxesStatus?: boolean;
    /** Local Presentation options applied before restoring apps. Not synchronized. */
    builtinAppOptions?: BuiltinAppOptions;
};

type MountStaticState = {
    displayer: Displayer | undefined;
    wrapper: HTMLElement | undefined;
    sizer: HTMLElement | undefined;
    playground: HTMLElement | undefined;
    container: HTMLElement | undefined;
    debug: boolean;
    containerSizeRatio: number;
    supportAppliancePlugin: boolean | undefined;
    params: MountParams | undefined;
    extendClass: ExtendClass | undefined;
};

export const reconnectRefresher = new ReconnectRefresher({ emitter: internalEmitter });
export class WindowManager
    extends InvisiblePlugin<WindowMangerAttributes, any>
    implements PageController
{
    public static readonly kind = "WindowManager";
    public static displayer: Displayer;
    public static wrapper?: HTMLElement;
    public static sizer?: HTMLElement;
    public static playground?: HTMLElement;
    public static container?: HTMLElement;
    public static debug = false;
    public static containerSizeRatio = DEFAULT_CONTAINER_RATIO;
    public static supportAppliancePlugin?: boolean;
    private static isCreated = false;
    private static isMounting = false;
    private static _resolve = (_manager: WindowManager) => void 0;

    public version = __APP_VERSION__;
    public dependencies = __APP_DEPENDENCIES__;

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    private _unifiedPageControl = new UnifiedPageControlTracker();
    public appManager?: AppManager;
    public cursorManager?: CursorManager;
    public viewMode = ViewMode.Broadcaster;
    public isReplay = isPlayer(this.displayer);
    private _pageState?: PageStateImpl;
    private _fullscreen?: boolean;
    private _destroyed = false;
    private _cursorUIDs: string[] = [];
    private _cursorUIDsStyleDOM?: HTMLStyleElement;
    public _appliancePlugin?: any;

    public builtinAppOptions?: BuiltinAppOptions;

    private _originSize?: Readonly<Size>;

    private boxManager?: BoxManager;
    private static params?: MountParams;
    static extendClass?: ExtendClass;

    private containerResizeObserver?: ContainerResizeObserver;
    public containerSizeRatio = WindowManager.containerSizeRatio;

    private extendPluginManager?: ExtendPluginManager;

    private _roomLogger?: Logger;

    public attributesDeboundceLog?: ArgusLog;

    get Logger(): Logger | undefined {
        return this._roomLogger;
    }

    public get originSize(): Readonly<Size> | undefined {
        return this._originSize;
    }

    constructor(context: InvisiblePluginContext) {
        super(context);
        WindowManager.displayer = context.displayer;
        (window as any).NETLESS_DEPS = __APP_DEPENDENCIES__;
        this.emitter.on("mainViewScenePathChange", this.onMainViewScenePathChangeHandler);
    }

    public static onCreate(manager: WindowManager) {
        WindowManager._resolve(manager);
    }

    public static async mount(
        params: MountParams,
        extendClass?: ExtendClass
    ): Promise<WindowManager> {
        const originSize = normalizeOriginSize(params.originSize);
        if (
            originSize &&
            params.containerSizeRatio !== undefined &&
            (!Number.isFinite(params.containerSizeRatio) || params.containerSizeRatio <= 0)
        ) {
            throw new Error(
                `[WindowManager]: containerSizeRatio must be a finite positive number in originSize mode, but got ${params.containerSizeRatio}`
            );
        }
        const room = params.room;
        const containerSizeRatio = params.containerSizeRatio;
        const debug = params.debug;
        const cursor = params.cursor;
        const previousStaticState = this.captureMountStaticState();
        checkVersion();
        if (WindowManager.isCreated || WindowManager.isMounting) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        WindowManager.isMounting = true;
        let manager: WindowManager | undefined = undefined;
        let shouldRollback = false;
        let mountCommitted = false;
        let previousDisableSerialization: boolean | undefined;
        let didChangeDisableSerialization = false;

        try {
            if (isRoom(room)) {
                if (room.phase !== RoomPhase.Connected) {
                    throw new Error("[WindowManager]: Room only Connected can be mount");
                }
                manager = await this.initManager(room);
            } else {
                await pRetry(
                    async count => {
                        manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
                        if (!manager) {
                            log(`manager is empty. retrying ${count}`);
                            throw new Error();
                        }
                    },
                    // 1s, 2s, 4s, 5s, 5s, 5s, 5s, 5s, 5s
                    { retries: 10, maxTimeout: 5000 } as any
                );
            }

            if (!manager) {
                throw new Error("[WindowManager]: create manager failed");
            }
            shouldRollback = true;
            manager._originSize = originSize;
            await manager.ensureAttributes();
            manager.ensureOriginCameraCompatibility();

            WindowManager.container = params.container;
            WindowManager.supportAppliancePlugin = params.supportAppliancePlugin;
            WindowManager.params = params;
            WindowManager.extendClass = extendClass;
            WindowManager.displayer = params.room;

            if (isRoom(room)) {
                const writableRoom = room as Room;
                if (writableRoom.isWritable) {
                    // redo undo 需要设置这个属性
                    previousDisableSerialization = writableRoom.disableSerialization;
                    writableRoom.disableSerialization = false;
                    didChangeDisableSerialization = true;
                }
                manager._roomLogger = createManagedRoomLogger(
                    (writableRoom as unknown as { logger: Logger }).logger
                );
                manager.attributesDeboundceLog = new ArgusLog(
                    manager._roomLogger,
                    "attributes",
                    300
                );
                if (WindowManager.registered.size > 0) {
                    manager._roomLogger.info(
                        `[WindowManager] registered apps: ${JSON.stringify(
                            Array.from(WindowManager.registered.keys())
                        )}`
                    );
                }
            }
            manager._roomLogger?.info(
                `[WindowManager] mount duplicate check passed: isCreated=${WindowManager.isCreated}`
            );
            this.debug = Boolean(debug);
            if (manager._roomLogger) {
                manager._roomLogger.info(
                    `[WindowManager] Already insert room version: ${manager.version}`
                );
            } else {
                log("Already insert room", manager);
            }

            manager.builtinAppOptions = params.builtinAppOptions;
            if (originSize) {
                WindowManager.containerSizeRatio = containerSizeRatio ?? DEFAULT_CONTAINER_RATIO;
            } else if (containerSizeRatio) {
                WindowManager.containerSizeRatio = containerSizeRatio;
            }

            const AppManagerClass = getExtendClass(AppManager, WindowManager.extendClass);
            const CursorManagerClass = getExtendClass(CursorManager, WindowManager.extendClass);

            manager._fullscreen = params.fullscreen;
            manager.appManager = new AppManagerClass(manager);
            manager.appManager.polling = params.polling || false;
            manager._pageState = new PageStateImpl(manager.appManager);
            manager.cursorManager = new CursorManagerClass(
                manager.appManager,
                Boolean(cursor),
                params.cursorOptions,
                params.applianceIcons
            );
            manager.ensureUnifiedPageStateListeners();

            manager.extendPluginManager = new ExtendPluginManager({
                internalEmitter: internalEmitter,
                windowManager: manager,
            });

            if (originSize) {
                manager.containerSizeRatio = containerSizeRatio ?? DEFAULT_CONTAINER_RATIO;
            } else if (containerSizeRatio) {
                manager.containerSizeRatio = containerSizeRatio;
            }

            if (params.container) {
                manager.bindContainer(params.container);
            }

            if (
                manager._roomLogger &&
                manager.attributes.registered &&
                Object.keys(manager.attributes.registered).length > 0
            ) {
                manager._roomLogger.info(
                    `[WindowManager] attributes registered apps: ${JSON.stringify(
                        Array.from(Object.keys(manager.attributes.registered))
                    )}`
                );
            }
            replaceRoomFunction(room, manager);
            internalEmitter.emit("onCreated");
            try {
                manager._roomLogger?.info("[WindowManager] indexedDB open start");
                await initDb(() => {
                    manager?._roomLogger?.warn("[WindowManager] indexedDB open blocked");
                });
                manager._roomLogger?.info("[WindowManager] indexedDB open success");
            } catch (error) {
                manager._roomLogger?.warn(
                    `[WindowManager] indexedDB open failed: ${error.message}`
                );
                console.warn("[WindowManager]: indexedDB open failed");
                console.log(error);
            }
            WindowManager.isCreated = true;
            mountCommitted = true;
            WindowManager.isMounting = false;
            return manager;
        } catch (error) {
            if (shouldRollback && manager && !mountCommitted) {
                this.rollbackFailedMount(manager, previousStaticState);
                if (didChangeDisableSerialization && isRoom(room)) {
                    (room as Room).disableSerialization = previousDisableSerialization as boolean;
                }
            } else if (!mountCommitted) {
                this.restoreMountStaticState(previousStaticState);
            }
            WindowManager.isMounting = false;
            throw error;
        }
    }

    private static captureMountStaticState(): MountStaticState {
        return {
            displayer: WindowManager.displayer,
            wrapper: WindowManager.wrapper,
            sizer: WindowManager.sizer,
            playground: WindowManager.playground,
            container: WindowManager.container,
            debug: WindowManager.debug,
            containerSizeRatio: WindowManager.containerSizeRatio,
            supportAppliancePlugin: WindowManager.supportAppliancePlugin,
            params: WindowManager.params,
            extendClass: WindowManager.extendClass,
        };
    }

    private static restoreMountStaticState(state: MountStaticState): void {
        WindowManager.displayer = state.displayer as Displayer;
        WindowManager.wrapper = state.wrapper;
        WindowManager.sizer = state.sizer;
        WindowManager.playground = state.playground;
        WindowManager.container = state.container;
        WindowManager.debug = state.debug;
        WindowManager.containerSizeRatio = state.containerSizeRatio;
        WindowManager.supportAppliancePlugin = state.supportAppliancePlugin;
        WindowManager.params = state.params;
        WindowManager.extendClass = state.extendClass;
    }

    private static rollbackFailedMount(
        manager: WindowManager,
        previousStaticState: MountStaticState
    ): void {
        const cleanup = (resource: string, callback: (() => void) | undefined): void => {
            if (!callback) return;
            try {
                callback();
            } catch (error) {
                console.warn(
                    `[WindowManager]: failed to clean ${resource} after mount error`,
                    error
                );
            }
        };
        cleanup("attributes logger", () => manager.attributesDeboundceLog?.destroy());
        cleanup("container resize observer", () => manager.containerResizeObserver?.disconnect());
        cleanup("app manager", () => manager.appManager?.destroy());
        cleanup("cursor manager", () => manager.cursorManager?.destroy());
        cleanup("extend plugin manager", () => manager.extendPluginManager?.destroy());
        cleanup("iframe bridge", () => manager._iframeBridge?.destroy());
        cleanup("unified page control", () => manager._unifiedPageControl.destroy());
        manager.attributesDeboundceLog = undefined;
        manager.containerResizeObserver = undefined;
        manager.appManager = undefined;
        manager.cursorManager = undefined;
        manager.extendPluginManager = undefined;
        manager.boxManager = undefined;
        manager._pageState = undefined;
        manager._iframeBridge = undefined;
        manager._roomLogger = undefined;
        manager._originSize = undefined;
        manager._fullscreen = undefined;
        manager.builtinAppOptions = undefined;
        manager.containerSizeRatio = previousStaticState.containerSizeRatio;
        manager._unifiedPageControl = new UnifiedPageControlTracker();
        if (
            WindowManager.playground &&
            WindowManager.playground !== previousStaticState.playground
        ) {
            cleanup("playground", () =>
                WindowManager.playground?.parentNode?.removeChild(WindowManager.playground)
            );
        }
        WindowManager._resolve = (_manager: WindowManager) => void 0;
        this.restoreMountStaticState(previousStaticState);
    }

    public onMainViewScenePathChangeHandler = (scenePath: string) => {
        const mainViewElement = this.mainView.divElement;
        if (mainViewElement) {
            const backgroundImage = mainViewElement.querySelector(".background img");
            if (backgroundImage) {
                const backgroundImageRect = backgroundImage?.getBoundingClientRect();
                const backgroundImageCSS = window.getComputedStyle(backgroundImage);
                const backgroundImageVisible =
                    backgroundImageRect?.width > 0 &&
                    backgroundImageRect?.height > 0 &&
                    backgroundImageCSS.display !== "none";
                const camera = this.mainView.camera;
                console.log(
                    "[window-manager] backgroundImageVisible:" +
                        backgroundImageVisible +
                        " camera:" +
                        JSON.stringify(camera)
                );
                return;
            }
            console.log(
                "[window-manager] onMainViewScenePathChange scenePath:" +
                    scenePath +
                    " backgroundImageVisible is not found"
            );
            return;
        }
        console.log(
            "[window-manager] onMainViewScenePathChange scenePath:" +
                scenePath +
                " mainViewElement is not found"
        );
    };

    private static initManager(room: Room): Promise<WindowManager | undefined> {
        return createInvisiblePlugin(room);
    }

    private static initContainer(
        manager: WindowManager,
        container: HTMLElement,
        params: {
            chessboard?: boolean;
            overwriteStyles?: string;
            fullscreen?: boolean;
        }
    ) {
        const { chessboard, overwriteStyles, fullscreen } = params;
        if (!WindowManager.container) {
            WindowManager.container = container;
        }
        const { playground, wrapper, sizer, mainViewElement } = setupWrapper(container);
        WindowManager.playground = playground;
        if (chessboard) {
            sizer.classList.add("netless-window-manager-chess-sizer");
        }
        if (fullscreen) {
            sizer.classList.add("netless-window-manager-fullscreen");
        }
        if (overwriteStyles) {
            const style = document.createElement("style");
            style.textContent = overwriteStyles;
            playground.appendChild(style);
        }
        manager.containerResizeObserver = ContainerResizeObserver.create(
            playground,
            sizer,
            wrapper,
            internalEmitter,
            manager.Logger,
            () => {
                const mainView = manager.appManager?.mainViewProxy.view;
                return {
                    mainViewElement: mainView?.divElement || undefined,
                    mainViewSize: mainView?.size,
                    teleBoxContainerRect: manager.boxManager?.teleBoxManager.containerRect,
                    mainViewDidRelease: Boolean((mainView as any)?.didRelease),
                    containerSizeRatio: manager.containerSizeRatio,
                };
            }
        );
        WindowManager.wrapper = wrapper;
        WindowManager.sizer = sizer;
        return mainViewElement;
    }

    public static get registered() {
        return appRegister.registered;
    }

    public bindContainer(container: HTMLElement) {
        if (isRoom(this.displayer) && this.room.phase !== RoomPhase.Connected) {
            throw new Errors.BindContainerRoomPhaseInvalidError();
        }
        if (WindowManager.isCreated && WindowManager.container) {
            if (WindowManager.container.firstChild) {
                container.appendChild(WindowManager.container.firstChild);
            }
        } else {
            if (WindowManager.params) {
                const params = WindowManager.params;
                const mainViewElement = WindowManager.initContainer(this, container, params);
                if (this.boxManager) {
                    this.boxManager.destroy();
                }
                const boxManager = createBoxManager(this, callbacks, internalEmitter, boxEmitter, {
                    collectorContainer: params.collectorContainer,
                    collectorStyles: params.collectorStyles,
                    prefersColorScheme: params.prefersColorScheme,
                    useBoxesStatus: params.useBoxesStatus,
                });
                this.boxManager = boxManager;
                if (this.appManager) {
                    this.appManager.useBoxesStatus = params.useBoxesStatus || false;
                    this.appManager.setBoxManager(boxManager);
                }
                this.bindMainView(mainViewElement, params.disableCameraTransform);
                if (WindowManager.wrapper) {
                    this.cursorManager?.setupWrapper(WindowManager.wrapper);
                }
            }
        }
        internalEmitter.emit("updateManagerRect");
        this.appManager?.refresh();
        this.appManager?.resetMaximized();
        this.appManager?.resetMinimized();
        this.appManager?.displayerWritableListener(!this.room.isWritable);
        WindowManager.container = container;
        this.containerResizeObserver?.logCurrentState("bindContainer");
        this.extendPluginManager?.refreshContainer(container);
    }

    public bindCollectorContainer(container: HTMLElement) {
        if (WindowManager.isCreated && this.boxManager) {
            this.boxManager.setCollectorContainer(container);
        } else {
            if (WindowManager.params) {
                WindowManager.params.collectorContainer = container;
            }
        }
    }

    /**
     * 注册插件
     */
    public static register(params: RegisterParams<any, any, any>): Promise<void> {
        return appRegister.register(params);
    }

    /**
     * 注销插件
     */
    public static unregister(kind: string) {
        return appRegister.unregister(kind);
    }

    public resolveAppOptions(
        kind: string,
        registeredOptions?: any | (() => any)
    ): any | (() => any) {
        const override =
            kind === BuiltinApps.Presentation ? this.builtinAppOptions?.Presentation : undefined;
        return mergeAppOptions(registeredOptions, override);
    }

    /**
     * 创建一个 app 至白板
     */
    public async addApp<T = any>(params: AddAppParams<T>): Promise<string | undefined> {
        if (this.appManager) {
            // 移除根目录时需要做一些异步的释放操作 addApp 需要等待释放完成才可以继续添加
            if (this.appManager.rootDirRemoving) {
                return new Promise((resolve, reject) => {
                    internalEmitter.once("rootDirRemoved").then(async () => {
                        try {
                            const appId = await this._addApp(params);
                            resolve(appId);
                        } catch (error) {
                            reject(error.message);
                        }
                    });
                });
            } else {
                return this._addApp(params);
            }
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    /**
     * Create an App and wait until its `setup()` has completed.
     *
     * Unlike `addApp()`, setup failures reject this Promise and the partially
     * initialized local App is removed. Existing `addApp()` timing is unchanged.
     */
    public async addAppAndWaitForSetup<T = any>(params: AddAppParams<T>): Promise<string> {
        const appId = await this.addApp(params);
        if (!appId) {
            throw new Error("[WindowManager]: app was not created");
        }
        const app = this.queryOne(appId);
        if (!app) {
            throw new Error(`[WindowManager]: app not found after creation, appId: ${appId}`);
        }
        try {
            await app.waitForSetup();
            return appId;
        } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error));
            try {
                await app.destroy(true, true, false, cause);
            } catch (cleanupError) {
                this.Logger?.error(
                    `[WindowManager]: failed to clean up app after setup error, appId: ${appId}, error: ${String(
                        cleanupError
                    )}`
                );
            }
            throw error;
        }
    }

    private async _addApp<T = any>(params: AddAppParams<T>): Promise<string | undefined> {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new Errors.ParamsInvalidError();
            }
            if (params.src && typeof params.src === "string") {
                appRegister.register({ kind: params.kind, src: params.src });
            }
            const appImpl = await appRegister.appClasses.get(params.kind)?.();
            if (appImpl && appImpl.config?.singleton) {
                if (this.appManager.appProxies.has(params.kind)) {
                    throw new Errors.AppCreateError();
                }
            }
            const isDynamicPPT = this.setupScenePath(params, this.appManager);
            if (isDynamicPPT === undefined) {
                return;
            }
            if (params?.options?.scenePath) {
                params.options.scenePath = ensureValidScenePath(params.options.scenePath);
            }
            const appId = await this.appManager.addApp(params, Boolean(isDynamicPPT));
            return appId;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    private setupScenePath(params: AddAppParams, appManager: AppManager): boolean | undefined {
        let isDynamicPPT = false;
        if (params.options) {
            const { scenePath, scenes } = params.options;
            if (scenePath) {
                if (!isValidScenePath(scenePath)) {
                    throw new Errors.InvalidScenePath();
                }
                const apps = Object.keys(this.apps || {});
                for (const appId of apps) {
                    const appScenePath = appManager.store.getAppScenePath(appId);
                    if (appScenePath && appScenePath === scenePath) {
                        console.warn(`[WindowManager]: ScenePath "${scenePath}" already opened`);
                        if (this.boxManager) {
                            const topBox = this.boxManager.getTopBox();
                            if (topBox) {
                                this.boxManager.setZIndex(appId, topBox.zIndex + 1, false);
                                this.boxManager.focusBox({ appId }, false);
                            }
                        }
                        return;
                    }
                }
            }
            if (scenePath && scenes && scenes.length > 0) {
                if (this.isDynamicPPT(scenes)) {
                    isDynamicPPT = true;
                    if (!entireScenes(this.displayer)[scenePath]) {
                        putScenes(this.room, scenePath, scenes);
                    }
                } else {
                    if (!entireScenes(this.displayer)[scenePath]) {
                        putScenes(this.room, scenePath, [{ name: scenes[0].name }]);
                    }
                }
            }
            if (scenePath && scenes === undefined) {
                putScenes(this.room, scenePath, [{}]);
            }
        }
        return isDynamicPPT;
    }

    /**
     * 设置 mainView 的 ScenePath, 并且切换白板为可写状态
     */
    public async setMainViewScenePath(scenePath: string): Promise<void> {
        if (this.appManager) {
            await this.appManager.setMainViewScenePath(scenePath);
        }
    }

    /**
     * 设置 mainView 的 SceneIndex, 并且切换白板为可写状态
     */
    public async setMainViewSceneIndex(index: number): Promise<void> {
        if (this.appManager) {
            await this.appManager.setMainViewSceneIndex(index);
        }
    }

    public async nextPage(): Promise<boolean> {
        if (this.appManager) {
            const nextIndex = this.mainViewSceneIndex + 1;
            if (nextIndex >= this.mainViewScenesLength) {
                console.warn(`[WindowManager]: current page is the last page`);
                return false;
            }
            await this.appManager.setMainViewSceneIndex(nextIndex);
            return true;
        } else {
            return false;
        }
    }

    public async prevPage(): Promise<boolean> {
        if (this.appManager) {
            const prevIndex = this.mainViewSceneIndex - 1;
            if (prevIndex < 0) {
                console.warn(`[WindowManager]: current page is the first page`);
                return false;
            }
            await this.appManager.setMainViewSceneIndex(prevIndex);
            return true;
        } else {
            return false;
        }
    }

    public async jumpPage(index: number): Promise<boolean> {
        if (this.appManager) {
            if (index < 0 || index >= this.pageState.length) {
                console.warn(`[WindowManager]: index ${index} out of range`);
                return false;
            }
            await this.appManager.setMainViewSceneIndex(index);
            return true;
        } else {
            return false;
        }
    }

    public async addPage(params?: AddPageParams): Promise<void> {
        if (this.appManager) {
            const after = params?.after;
            const scene = params?.scene;
            if (after) {
                const nextIndex = this.mainViewSceneIndex + 1;
                this.room.putScenes(ROOT_DIR, [scene || {}], nextIndex);
            } else {
                this.room.putScenes(ROOT_DIR, [scene || {}]);
            }
        }
    }

    /**
     * 删除一页
     * 默认删除当前页, 可以删除指定 index 页
     * 最低保留一页
     */
    public async removePage(index?: number): Promise<boolean> {
        if (this.appManager) {
            const needRemoveIndex = index === undefined ? this.pageState.index : index;
            if (this.pageState.length === 1) {
                console.warn(`[WindowManager]: can not remove the last page`);
                return false;
            }
            if (needRemoveIndex < 0 || needRemoveIndex >= this.pageState.length) {
                console.warn(`[WindowManager]: index ${index} out of range`);
                return false;
            }
            return this.appManager.removeSceneByIndex(needRemoveIndex);
        } else {
            return false;
        }
    }

    /**
     * 返回 mainView 的 ScenePath
     */
    public getMainViewScenePath(): string | undefined {
        return this.appManager?.store.getMainViewScenePath();
    }

    /**
     * 返回 mainView 的 SceneIndex
     */
    public getMainViewSceneIndex(): number {
        return this.appManager?.store.getMainViewSceneIndex();
    }

    /**
     * 设置所有 app 的 readonly 模式
     */
    public setReadonly(readonly: boolean): void {
        this.readonly = readonly;
        this.boxManager?.setReadonly(readonly);
        internalEmitter.emit("setReadonly", readonly);
    }

    /**
     * 切换 mainView 为可写
     */
    public switchMainViewToWriter(): Promise<void> | undefined {
        return this.appManager?.mainViewProxy.mainViewClickHandler();
    }

    /**
     * app destroy 回调
     */
    public onAppDestroy(kind: string, listener: (error: Error) => void): void {
        addEmitterOnceListener(`destroy-${kind}`, listener);
    }

    /**
     * app 本地自定义事件回调
     *
     * 返回一个用于撤销此监听的函数
     */
    public onAppEvent(
        kind: string,
        listener: (args: { kind: string; appId: string; type: string; value: any }) => void
    ): () => void {
        return internalEmitter.on(`custom-${kind}` as any, listener);
    }

    /**
     * 设置 ViewMode
     */
    public setViewMode(mode: ViewMode): void {
        if (mode === ViewMode.Broadcaster || mode === ViewMode.Follower) {
            if (!this.originSize && this.canOperate && mode === ViewMode.Broadcaster) {
                this.appManager?.mainViewProxy.setCameraAndSize();
            }
            this.appManager?.mainViewProxy.start();
        }
        if (mode === ViewMode.Freedom) {
            this.appManager?.mainViewProxy.stop();
        }
        this.viewMode = mode;
        this.appManager?.mainViewProxy.setViewMode(mode);
    }

    public setBoxState(boxState: TeleBoxState): void {
        if (!this.canOperate) return;
        switch (boxState) {
            case "normal":
                this.setMaximized(false);
                this.setMinimized(false);
                break;
            case "maximized":
                this.setMaximized(true);
                this.setMinimized(false);
                break;
            case "minimized":
                this.setMinimized(true);
                break;
            default:
                break;
        }
    }

    public setMaximized(maximized: boolean): void {
        if (!this.canOperate) return;
        this.boxManager?.setMaximized(maximized, false);
    }

    public setMinimized(minimized: boolean): void {
        if (!this.canOperate) return;
        this.boxManager?.setMinimized(minimized, false);
    }

    /** 设置指定 box 的状态, 如果为 undefined, 则移除状态*/
    public setBoxStatus(boxId: string, boxStatus?: TELE_BOX_STATE): void {
        if (!this.canOperate) return;
        this.appManager?.store.setBoxStatus(boxId, boxStatus);
    }

    /** 设置指定 box 的非最小化状态, 如果为 undefined, 则移除状态 */
    public setLastNotMinimizedBoxStatus(
        boxId: string,
        lastNotMinimizedBoxStatus?: NotMinimizedBoxState
    ): void {
        if (!this.canOperate) return;
        this.appManager?.store.setLastNotMinimizedBoxStatus(boxId, lastNotMinimizedBoxStatus);
    }

    public setFullscreen(fullscreen: boolean): void {
        if (this._fullscreen !== fullscreen) {
            this._fullscreen = fullscreen;
            WindowManager.sizer?.classList.toggle("netless-window-manager-fullscreen", fullscreen);
            callbacks.emit("fullscreenChange", fullscreen);
        }
    }

    public get cursorUIDs(): string[] {
        return this._cursorUIDs;
    }

    public setCursorUIDs(cursorUIDs?: string[] | null): void {
        this._cursorUIDs = cursorUIDs || [];
        if (this._cursorUIDs.length === 0) {
            this._cursorUIDsStyleDOM?.remove();
        } else {
            if (!this._cursorUIDsStyleDOM) {
                this._cursorUIDsStyleDOM = document.createElement("style");
            }
            WindowManager.playground?.appendChild(this._cursorUIDsStyleDOM);
            let style = "[data-cursor-uid] { display: none }";
            for (const uid of this._cursorUIDs) {
                style += `\n[data-cursor-uid="${uid}"] { display: flex }`;
            }
            this._cursorUIDsStyleDOM.textContent = style;
        }
    }

    public get mainView(): View {
        if (this.appManager) {
            return this.appManager.mainViewProxy.view;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get camera(): Camera {
        if (this.appManager) {
            return this.appManager.mainViewProxy.view.camera;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get cameraState(): CameraState {
        if (this.appManager) {
            return this.appManager.mainViewProxy.cameraState;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get apps(): Apps | undefined {
        return this.appManager?.store.apps();
    }

    public get boxState(): TeleBoxState | undefined {
        if (this.appManager) {
            return this.appManager.boxManager?.boxState;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get boxStatus(): Record<string, TeleBoxState> | undefined {
        if (this.appManager) {
            return this.appManager.store.getBoxesStatus();
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get lastNotMinimizedBoxStatus(): Record<string, NotMinimizedBoxState> | undefined {
        if (this.appManager) {
            return this.appManager.store.getLastNotMinimizedBoxesStatus();
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get darkMode(): boolean {
        return Boolean(this.appManager?.boxManager?.darkMode);
    }

    public get prefersColorScheme(): TeleBoxColorScheme | undefined {
        if (this.appManager) {
            return this.appManager.boxManager?.prefersColorScheme;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get focused(): string | undefined {
        return this.attributes.focus;
    }

    public get focusedView(): View | undefined {
        return this.appManager?.focusApp?.view || this.mainView;
    }

    public get polling(): boolean {
        return this.appManager?.polling || false;
    }

    public set polling(b: boolean) {
        if (this.appManager) {
            this.appManager.polling = b;
        }
    }

    public get cursorStyle(): "default" | "custom" {
        return this.cursorManager?.style || "default";
    }

    public set cursorStyle(value: "default" | "custom") {
        if (!this.cursorManager) {
            throw new Error("[WindowManager]: cursor is not enabled, please set { cursor: true }.");
        }
        this.cursorManager.style = value;
    }

    public get mainViewSceneIndex(): number {
        return this._pageState?.index || 0;
    }

    public get mainViewSceneDir(): string {
        if (this.appManager) {
            return this.appManager?.getMainViewSceneDir();
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get topApp(): string | undefined {
        return this.boxManager?.getTopBox()?.id;
    }

    public get mainViewScenesLength(): number {
        return this._pageState?.length || 0;
    }

    public get canRedoSteps(): number {
        return this.focusedView?.canRedoSteps || 0;
    }

    public get canUndoSteps(): number {
        return this.focusedView?.canUndoSteps || 0;
    }

    public get sceneState(): SceneState {
        if (this.appManager) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.appManager.sceneState!;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get pageState(): PageState {
        if (this._pageState) {
            return this._pageState.toObject();
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get fullscreen(): boolean {
        return Boolean(this._fullscreen);
    }

    /**
     * 查询所有的 App
     */
    public queryAll(): AppProxy[] {
        return Array.from(this.appManager?.appProxies.values() || []);
    }

    /**
     * 查询单个 App
     */
    public queryOne(appId: string): AppProxy | undefined {
        return this.appManager?.appProxies.get(appId);
    }

    /**
     * Send specific command to DocsViewer / Presentation / Slide app.
     *
     * Static docs and Presentation do not have animation steps, so `prevStep` / `nextStep`
     * are treated as `prevPage` / `nextPage`.
     */
    public dispatchDocsEvent(event: DocsEvent, options: DocsEventOptions = {}): boolean {
        const appId = options.appId || this.focused;
        if (!appId) {
            console.warn("not found " + (options.appId || "focused app"));
            return false;
        }

        const app = this.queryOne(appId);
        if (!app) {
            console.warn("not found app with id " + appId);
            return false;
        }

        const isDocsViewerApp =
            appId.startsWith(`${BuiltinApps.DocsViewer}-`) || app.kind === BuiltinApps.DocsViewer;
        const isPresentationApp =
            appId.startsWith(`${PresentationAppKind}-`) || app.kind === PresentationAppKind;
        const isSlideApp = appId.startsWith(`${SlideAppKind}-`) || app.kind === SlideAppKind;
        let appKind = app.kind;
        if (isDocsViewerApp) {
            appKind = BuiltinApps.DocsViewer;
        } else if (isPresentationApp) {
            appKind = PresentationAppKind;
        } else if (isSlideApp) {
            appKind = SlideAppKind;
        }

        if (!WindowManager.registered.has(appKind)) {
            console.warn("not registered app kind " + appKind);
            return false;
        }

        let page: number | undefined, input: HTMLInputElement | null, scale: number | undefined;

        if (isDocsViewerApp) {
            const dom = app.box?.$footer;
            if (!dom) {
                console.warn("not found app with id " + appId);
                return false;
            }

            const click = (el: Element | null) => {
                el && el.dispatchEvent(new MouseEvent("click"));
            };

            switch (event) {
                case "prevPage":
                case "prevStep":
                    click(dom.querySelector('button[class$="btn-page-back"]'));
                    break;
                case "nextPage":
                case "nextStep":
                    click(dom.querySelector('button[class$="btn-page-next"]'));
                    break;
                case "jumpToPage":
                    page = options.page;
                    input = dom.querySelector('input[class$="page-number-input"]');
                    if (!input || typeof page !== "number") {
                        console.warn("failed to jump" + (page ? " to page " + page : ""));
                        return false;
                    }
                    input.value = "" + page;
                    input.dispatchEvent(new InputEvent("change"));
                    break;
                case "scalePage":
                    console.warn("not supported event " + event + " for app kind " + appKind);
                    return false;
                default:
                    console.warn("unknown event " + event);
                    return false;
            }

            return true;
        }

        if (isPresentationApp) {
            const controller = app.appResult as PresentationPageController | undefined;
            if (!controller) {
                console.warn("not found app with id " + appId);
                return false;
            }

            if (event === "scalePage") {
                scale = options.scale;
                if (!isValidDocsPageScale(scale)) {
                    console.warn("failed to scale, scale should be a number from 1 to 4");
                    return false;
                }
                try {
                    controller.moveCamera({
                        centerX: 0,
                        centerY: 0,
                        scale: controller.getOriginScale() * scale,
                    });
                    return true;
                } catch (error) {
                    console.warn(error);
                    return false;
                }
            }
            const pageEvent: PageEvent =
                event === "prevStep" ? "prevPage" : event === "nextStep" ? "nextPage" : event;
            if (pageEvent === "jumpToPage" && typeof options.page !== "number") {
                console.warn("failed to jump" + (options.page ? " to page " + options.page : ""));
                return false;
            }
            return (
                executeAppPageCommand(PresentationAppKind, controller, pageEvent, options.page) ===
                true
            );
        }

        if (isSlideApp) {
            const controller = app.appResult as SlidePageController | undefined;
            if (!controller) {
                console.warn("not found app with id " + appId);
                return false;
            }

            if (event === "scalePage") {
                scale = options.scale;
                if (!isValidDocsPageScale(scale)) {
                    console.warn("failed to scale, scale should be a number from 1 to 4");
                    return false;
                }
                controller.scaleView(scale);
                return true;
            }
            if (event === "jumpToPage" && typeof options.page !== "number") {
                console.warn("failed to jump" + (options.page ? " to page " + options.page : ""));
                return false;
            }
            return executeAppPageCommand(SlideAppKind, controller, event, options.page) === true;
        }

        console.warn("not supported app kind " + app.kind);
        return false;
    }

    /**
     * Dispatches the new unified page command. The returned Promise only means
     * that the command was accepted. unifiedPageStateChange reports observed page
     * sources; Slide consumers must require status === "success" before treating them as aligned.
     */
    public dispatchPageEvent(event: PageEvent, options: PageEventOptions = {}): Promise<boolean> {
        if (this._destroyed) {
            return Promise.resolve(false);
        }
        this.ensureUnifiedPageStateListeners();
        if (!options || typeof options !== "object" || Array.isArray(options))
            return Promise.resolve(false);
        if (
            event !== "prevPage" &&
            event !== "nextPage" &&
            event !== "prevStep" &&
            event !== "nextStep" &&
            event !== "jumpToPage"
        ) {
            return Promise.resolve(false);
        }
        const target = this.resolveUnifiedPageTarget(options);
        if (!target) return Promise.resolve(false);
        if (target === "mainView") {
            if (
                !this.appManager ||
                !this._pageState ||
                !this.pageState.length ||
                !this.canOperate
            ) {
                return Promise.resolve(false);
            }
            const currentPage = this.pageState.index + 1;
            const pageCount = this.pageState.length;
            let expectedPage = currentPage;
            if (event === "prevStep" || event === "nextStep") return Promise.resolve(false);
            if (event === "prevPage") expectedPage -= 1;
            if (event === "nextPage") expectedPage += 1;
            if (event === "jumpToPage") {
                if (!this.isUnifiedPage(options.page, pageCount)) return Promise.resolve(false);
                expectedPage = options.page;
            }
            if (expectedPage < 1 || expectedPage > pageCount) return Promise.resolve(false);
            if (expectedPage === currentPage) return Promise.resolve(false);
            const currentScenePath = this.getUnifiedMainViewScenePath(currentPage);
            const expectedScenePath = this.getUnifiedMainViewScenePath(expectedPage);
            if (
                !currentScenePath ||
                !expectedScenePath ||
                !this.isUnifiedMainViewSceneConfirmed(currentPage, currentScenePath)
            ) {
                return Promise.resolve(false);
            }
            let command: Promise<boolean>;
            try {
                if (event === "prevPage") command = this.prevPage();
                else if (event === "nextPage") command = this.nextPage();
                else command = this.jumpPage(expectedPage - 1);
            } catch (error) {
                this.logUnifiedPageException(
                    this.unifiedPageStateKey(undefined, "mainView"),
                    "dispatchPageEvent",
                    error,
                    { target: "mainView", event, page: expectedPage, pageCount }
                );
                return Promise.resolve(false);
            }
            void command
                .then(success => {
                    if (!success) {
                        this.emitUnifiedPageCommandFailure(
                            "mainView",
                            event,
                            expectedPage,
                            pageCount
                        );
                    }
                })
                .catch(error => {
                    this.emitUnifiedPageCommandFailure(
                        "mainView",
                        event,
                        expectedPage,
                        pageCount,
                        undefined,
                        String(error)
                    );
                });
            return Promise.resolve(true);
        }

        const appId = target;
        if (!appId) return Promise.resolve(false);
        const app = this.queryOne(appId);
        const appKind = this.getUnifiedAppKind(app?.kind);
        if (!app || !appKind || !WindowManager.registered.has(appKind) || !app.appResult) {
            return Promise.resolve(false);
        }
        const state = this.readUnifiedAppPageState(appId, appKind);
        if (!state || !app.box || !this.canOperate) {
            return Promise.resolve(false);
        }
        this.ensureUnifiedAppObserver(appId, appKind);
        if (!this.canInitializeUnifiedAppState(appId, appKind, state)) {
            return Promise.resolve(false);
        }
        const isStepEvent = this.isUnifiedStepEvent(event);
        if (isStepEvent) {
            if (appKind !== SlideAppKind) return Promise.resolve(false);
        }
        if (appKind === SlideAppKind && !this.canDispatchUnifiedSlideCommand(appId, event)) {
            return Promise.resolve(false);
        }
        let expectedPage = state.page;
        if (event === "prevPage") expectedPage -= 1;
        if (event === "nextPage") expectedPage += 1;
        if (event === "jumpToPage") {
            if (!this.isUnifiedPage(options.page, state.pageCount)) return Promise.resolve(false);
            expectedPage = options.page;
        }
        if (event === "prevPage" || event === "nextPage" || event === "jumpToPage") {
            if (expectedPage < 1 || expectedPage > state.pageCount) return Promise.resolve(false);
            if (expectedPage === state.page) return Promise.resolve(false);
        }
        if (appKind === SlideAppKind) {
            this.ensureUnifiedSlideRenderListener(appId, app);
        }
        let result: boolean | Promise<boolean>;
        try {
            result = executeAppPageCommand(
                appKind,
                app.appResult as unknown as PresentationPageController | SlidePageController,
                event,
                expectedPage,
                true
            );
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "dispatchPageEvent",
                error,
                {
                    target: state.target,
                    appId,
                    event,
                    page: expectedPage,
                    pageCount: state.pageCount,
                }
            );
            return Promise.resolve(false);
        }
        if (typeof result === "boolean") {
            return Promise.resolve(result);
        }
        if (!result || typeof (result as any).then !== "function") {
            return Promise.resolve(false);
        }
        void Promise.resolve(result)
            .then(accepted => {
                if (!accepted) {
                    this.emitUnifiedPageCommandFailure(
                        state.target,
                        event,
                        expectedPage,
                        state.pageCount,
                        appId
                    );
                }
            })
            .catch(error => {
                this.emitUnifiedPageCommandFailure(
                    state.target,
                    event,
                    expectedPage,
                    state.pageCount,
                    appId,
                    String(error)
                );
            });
        return Promise.resolve(true);
    }

    public getPageState(options: PageStateOptions = {}): Promise<UnifiedPageState> {
        if (this._destroyed) {
            return Promise.reject(new Error("window manager was destroyed"));
        }
        this.ensureUnifiedPageStateListeners();
        if (!options || typeof options !== "object" || Array.isArray(options))
            return Promise.reject(new Error("invalid page state options"));
        if (Object.prototype.hasOwnProperty.call(options, "page")) {
            return Promise.reject(new Error("invalid page state options"));
        }
        const target = this.resolveUnifiedPageTarget(options);
        if (!target) return Promise.reject(new Error("invalid page state target"));
        if (target === "mainView") {
            if (!this.appManager || !this._pageState || !this.pageState.length)
                return Promise.reject(new Error("mainView page state unavailable"));
            const state = {
                target: "mainView",
                page: this.pageState.index + 1,
                pageCount: this.pageState.length,
            } as const;
            const scenePath = this.getUnifiedMainViewScenePath(state.page);
            if (!scenePath || !this.isUnifiedMainViewSceneConfirmed(state.page, scenePath)) {
                return Promise.reject(new Error("mainView page state is not confirmed"));
            }
            return Promise.resolve(state);
        }
        const appId = target;
        const app = appId ? this.queryOne(appId) : undefined;
        const appKind = appId ? this.getUnifiedAppKind(app?.kind) : undefined;
        if (appId && appKind) this.ensureUnifiedAppObserver(appId, appKind);
        if (appId && appKind === SlideAppKind) {
            const state = this.readUnifiedAppPageState(appId, appKind);
            if (!state) {
                return Promise.reject(new Error("page state unavailable"));
            }
            return Promise.resolve(state);
        }
        const state = appId && appKind ? this.readUnifiedAppPageState(appId, appKind) : undefined;
        if (
            !state ||
            !appId ||
            !appKind ||
            !this.canInitializeUnifiedAppState(appId, appKind, state)
        ) {
            return Promise.reject(new Error("page state unavailable or not confirmed"));
        }
        return Promise.resolve(state);
    }

    private isUnifiedPage(page: number | undefined, pageCount: number): page is number {
        return typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= pageCount;
    }

    private emitUnifiedPageCommandFailure(
        target: UnifiedPageState["target"],
        event: PageEvent,
        page: number,
        pageCount: number,
        appId?: string,
        message?: string
    ): void {
        this.emitUnifiedPageStateChange({
            status: "failure",
            target,
            appId,
            event,
            page,
            pageCount,
            reason: "commandFailed",
            message,
        });
    }

    private emitUnifiedPageStateChange(state: UnifiedPageStateChange): void {
        const key = this.unifiedPageStateKey(state.appId, state.target);
        const logger = this.Logger;
        if (state.status === "success") {
            this._unifiedPageControl.clearLoggedError(key);
            if (logger && this._unifiedPageControl.shouldLogSuccessState(key, state)) {
                logger.info(
                    `[WindowManager]: unifiedPageStateChange success ${JSON.stringify(state)}`
                );
            }
        } else if (state.status === "failure" && logger) {
            const signature = JSON.stringify(state);
            if (this._unifiedPageControl.shouldLogError(key, signature)) {
                const message = `[WindowManager]: unifiedPageStateChange failure ${signature}`;
                if (state.message) logger.error(message);
                else logger.warn(message);
            }
        }
        this.emitter.emit("unifiedPageStateChange", state);
    }

    private logUnifiedPageException(
        key: string,
        stage: string,
        error: unknown,
        context: Record<string, unknown>
    ): void {
        const summary = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const detail = error instanceof Error ? error.stack || summary : summary;
        const signature = `${stage}:${summary}`;
        const logger = this.Logger;
        if (!logger) return;
        if (!this._unifiedPageControl.shouldLogError(key, signature)) return;
        logger.error(
            `[WindowManager]: unified page control exception, stage=${stage}, context=${JSON.stringify(
                context
            )}, error=${detail}`
        );
    }

    private unifiedPageStateKey(appId?: string, target?: UnifiedPageState["target"]): string {
        return appId ? `app:${appId}` : `target:${target}`;
    }

    private isUnifiedStepEvent(event: PageEvent): boolean {
        return event === "prevStep" || event === "nextStep";
    }

    private getUnifiedMainViewScenePath(page: number): string | undefined {
        const sceneName = this.appManager?.sceneState?.scenes?.[page - 1]?.name;
        return sceneName ? `${ROOT_DIR}${sceneName}` : undefined;
    }

    private isUnifiedMainViewSceneConfirmed(page: number, expectedScenePath: string): boolean {
        const focusSceneIndex = this.mainView.focusSceneIndex;
        return (
            typeof focusSceneIndex === "number" &&
            focusSceneIndex + 1 === page &&
            this.mainView.focusScenePath === expectedScenePath
        );
    }

    private resolveUnifiedPageTarget(
        options: PageEventOptions | PageStateOptions
    ): PageEventTarget | undefined {
        // `appId` belonged to an unreleased draft of the unified API. Reject it
        // instead of silently dispatching to the focused app or mainView.
        if (Object.prototype.hasOwnProperty.call(options, "appId")) return undefined;
        if (options.target !== undefined) {
            if (typeof options.target !== "string" || options.target.length === 0) return undefined;
            return options.target;
        }
        return this.focused || "mainView";
    }

    private getUnifiedAppKind(
        kind?: string
    ): typeof SlideAppKind | typeof PresentationAppKind | undefined {
        if (kind === SlideAppKind) return SlideAppKind;
        if (kind === PresentationAppKind) return PresentationAppKind;
        return undefined;
    }

    private readUnifiedAppPageState(appId: string, kind: string): UnifiedPageState | undefined {
        try {
            const app = this.queryOne(appId);
            if (!app) return undefined;
            if (kind === SlideAppKind) {
                const position = (app.appResult as any)?.position?.();
                if (
                    !position ||
                    !Number.isInteger(position[0]) ||
                    !Number.isInteger(position[1]) ||
                    position[0] < 1 ||
                    position[1] < 1 ||
                    position[0] > position[1]
                )
                    return undefined;
                return { target: "Slide", appId, page: position[0], pageCount: position[1] };
            }
            const state = (app.appResult as PresentationPageController | undefined)?.pageState?.();
            if (
                !state ||
                !Number.isInteger(state.index) ||
                !Number.isInteger(state.length) ||
                state.length < 1 ||
                state.index < 0 ||
                state.index >= state.length
            )
                return undefined;
            return {
                target: "Presentation",
                appId,
                page: state.index + 1,
                pageCount: state.length,
            };
        } catch (error) {
            this.logUnifiedPageException(this.unifiedPageStateKey(appId), "readPageState", error, {
                target: kind,
                appId,
            });
            return undefined;
        }
    }

    private canInitializeUnifiedAppState(
        appId: string,
        kind: string,
        state: UnifiedPageState
    ): boolean {
        if (kind !== SlideAppKind) return this.isUnifiedAppSceneConfirmed(appId, state.page);
        if (this._unifiedPageControl.getLastSlideRenderPage(appId) === state.page) return true;
        try {
            const appResult = this.queryOne(appId)?.appResult as any;
            const controller = appResult?.controller?.();
            const slide = appResult?.slide?.();
            return Boolean(
                controller?.ready &&
                    slide &&
                    slide.isLoading === false &&
                    slide.slideState?.currentSlideIndex === state.page
            );
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "initializeSlideState",
                error,
                { target: "Slide", appId, page: state.page, pageCount: state.pageCount }
            );
            return false;
        }
    }

    private canDispatchUnifiedSlideCommand(appId: string, event?: PageEvent): boolean {
        try {
            const appResult = this.queryOne(appId)?.appResult as any;
            const controller = appResult?.controller?.();
            const slide = appResult?.slide?.();
            const ready = Boolean(
                controller?.ready &&
                    slide &&
                    slide.isLoading === false &&
                    slide.isAnimating !== true
            );
            if (!ready || !event || !this.isUnifiedStepEvent(event)) return ready;
            const hasStep = event === "prevStep" ? slide.hasPrevStep : slide.hasNextStep;
            if (typeof hasStep !== "function") return false;
            return hasStep.call(slide) === true;
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "checkSlideCommand",
                error,
                { target: "Slide", appId, event }
            );
            return false;
        }
    }

    private tryEmitUnifiedMainViewState(pageState?: PageState): void {
        try {
            this.emitUnifiedMainViewState(pageState);
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(undefined, "mainView"),
                "observeMainViewState",
                error,
                { target: "mainView" }
            );
        }
    }

    private emitUnifiedMainViewState(pageState?: PageState): void {
        const currentPageState = pageState || (this._pageState ? this.pageState : undefined);
        if (!currentPageState) return;
        if (
            !Number.isInteger(currentPageState.length) ||
            currentPageState.length < 1 ||
            !Number.isInteger(currentPageState.index) ||
            currentPageState.index < 0 ||
            currentPageState.index >= currentPageState.length
        )
            return;
        const next = {
            target: "mainView" as const,
            page: currentPageState.index + 1,
            pageCount: currentPageState.length,
            status: "success" as const,
            mainView: currentPageState.index + 1,
        };
        const expectedScenePath = this.getUnifiedMainViewScenePath(next.page);
        if (
            !expectedScenePath ||
            !this.isUnifiedMainViewSceneConfirmed(next.page, expectedScenePath)
        )
            return;
        if (
            this._unifiedPageControl.emitObservedState(
                this.unifiedPageStateKey(undefined, "mainView"),
                next
            )
        ) {
            this.emitUnifiedPageStateChange(next);
        }
    }

    private ensureUnifiedPageStateListeners() {
        if (this._unifiedPageControl.isListenersInstalled) return;
        this._unifiedPageControl.markListenersInstalled();
        this._unifiedPageControl.addListenerDisposer(
            this.emitter.on("pageStateChange", state => {
                this.tryEmitUnifiedMainViewState(state);
            })
        );
        this._unifiedPageControl.addListenerDisposer(
            this.emitter.on("mainViewScenePathChange", () => {
                this.tryEmitUnifiedMainViewState();
            })
        );
        this._unifiedPageControl.addListenerDisposer(
            this.emitter.on("onMainViewRebind", () => {
                this._unifiedPageControl.clearState(
                    this.unifiedPageStateKey(undefined, "mainView")
                );
            })
        );
        this._unifiedPageControl.addListenerDisposer(
            this.emitter.on("appsChange", () => {
                for (const app of this.queryAll()) {
                    const kind = this.getUnifiedAppKind(app.kind);
                    if (kind) this.ensureUnifiedAppObserver(app.id, kind);
                }
            })
        );
        this._unifiedPageControl.addListenerDisposer(
            this.emitter.on("onAppSetup", appId => {
                const app = this.queryOne(appId);
                const kind = app && this.getUnifiedAppKind(app.kind);
                if (kind) this.ensureUnifiedAppObserver(appId, kind);
            })
        );
        this._unifiedPageControl.addListenerDisposer(
            this.emitter.on("onAppScenePathChange", async payload => {
                // Presentation updates its controller page index from the same event.
                // Read it after every listener has observed the new View scene path.
                await Promise.resolve();
                const app = this.queryOne(payload.appId);
                const kind = app && this.getUnifiedAppKind(app.kind);
                if (kind) this.tryEmitUnifiedAppState(payload.appId, kind);
            })
        );
        for (const app of this.queryAll()) {
            const kind = this.getUnifiedAppKind(app.kind);
            if (kind) this.ensureUnifiedAppObserver(app.id, kind);
        }
    }

    private ensureUnifiedAppObserver(appId: string, kind: string) {
        const app = this.queryOne(appId);
        if (!app) return;
        if (this._unifiedPageControl.hasAppObserver(appId)) {
            if (kind === SlideAppKind) this.ensureUnifiedSlideRenderListener(appId, app);
            return;
        }
        const destroyDisposer = app.appEmitter.on("destroy", () => {
            this._unifiedPageControl.clearApp(appId);
        });
        const disposers = [destroyDisposer];
        if (kind === PresentationAppKind) {
            disposers.push(
                app.appEmitter.on("pageStateChange", () => {
                    this.tryEmitUnifiedAppState(appId, kind);
                })
            );
        }
        this._unifiedPageControl.setAppObserverDisposers(appId, disposers);
        if (kind === SlideAppKind) this.ensureUnifiedSlideRenderListener(appId, app);
    }

    private ensureUnifiedSlideRenderListener(appId: string, app: AppProxy) {
        if (!app.appResult || this._unifiedPageControl.hasSlideObserverDisposer(appId)) return;
        this.armUnifiedSlideRenderListener(appId, app);
    }

    private armUnifiedSlideRenderListener(appId: string, app: AppProxy) {
        try {
            const slide = (app.appResult as any)?.slide?.();
            if (!slide?.on) return;
            if (this._unifiedPageControl.hasSlideObserverDisposer(appId)) return;
            this.getOrInitializeUnifiedSlideRenderPage(appId);
            const renderListener = (page: number) => {
                if (!Number.isInteger(page) || page < 1) return;
                this._unifiedPageControl.setLastSlideRenderPage(appId, page);
                this.emitUnifiedSlidePageComparison(appId, page);
            };
            slide.on("renderEnd", renderListener);
            this._unifiedPageControl.setSlideObserverDisposer(appId, () => {
                slide.off?.("renderEnd", renderListener);
            });
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "installSlideRenderListener",
                error,
                { target: "Slide", appId }
            );
        }
    }

    private tryEmitUnifiedAppState(appId: string, kind: string) {
        if (kind === SlideAppKind) {
            this.emitUnifiedSlidePageComparison(appId);
            return;
        }
        const state = this.readUnifiedAppPageState(appId, kind);
        if (!state || !this.isUnifiedAppSceneConfirmed(appId, state.page)) return;
        const next: UnifiedPageStateChange = {
            ...state,
            status: "success",
            presentation: state.page,
        };
        const changed = this._unifiedPageControl.emitObservedState(
            this.unifiedPageStateKey(appId),
            next
        );
        if (changed) this.emitUnifiedPageStateChange(next);
    }

    private emitUnifiedSlidePageComparison(appId: string, renderPage?: number): void {
        const state = this.readUnifiedAppPageState(appId, SlideAppKind);
        const viewPage = this.readUnifiedSlideViewPage(appId);
        const comparedRenderPage =
            renderPage ?? this.getOrInitializeUnifiedSlideRenderPage(appId, state?.pageCount);
        if (
            !state ||
            !Number.isInteger(comparedRenderPage) ||
            (comparedRenderPage as number) < 1 ||
            (comparedRenderPage as number) > state.pageCount ||
            viewPage === undefined
        ) {
            return;
        }
        const slidePage = comparedRenderPage as number;
        const next: UnifiedPageStateChange = {
            target: "Slide",
            appId,
            page: slidePage,
            pageCount: state.pageCount,
            status: viewPage === slidePage ? "success" : "pending",
            view: viewPage,
            slide: slidePage,
        };
        this._unifiedPageControl.emitObservedState(this.unifiedPageStateKey(appId), next, true);
        this.emitUnifiedPageStateChange(next);
    }

    private getOrInitializeUnifiedSlideRenderPage(
        appId: string,
        pageCount?: number
    ): number | undefined {
        const cached = this._unifiedPageControl.getLastSlideRenderPage(appId);
        if (cached !== undefined) return cached;
        try {
            const appResult = this.queryOne(appId)?.appResult as any;
            const controller = appResult?.controller?.();
            const slide = appResult?.slide?.();
            const page = slide?.slideState?.currentSlideIndex;
            if (
                controller?.ready !== true ||
                slide?.isLoading !== false ||
                !Number.isInteger(page) ||
                page < 1 ||
                (pageCount !== undefined && page > pageCount)
            ) {
                return undefined;
            }
            this._unifiedPageControl.setLastSlideRenderPage(appId, page);
            return page;
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "readSlideRenderState",
                error,
                { target: "Slide", appId, pageCount }
            );
            return undefined;
        }
    }

    private readUnifiedSlideViewPage(appId: string): number | undefined {
        try {
            const scenePath = this.queryOne(appId)?.view?.focusScenePath;
            if (typeof scenePath !== "string") return undefined;
            const pageName = scenePath.split("/").filter(Boolean).pop();
            if (!pageName || !/^\d+$/.test(pageName)) return undefined;
            const page = Number(pageName);
            return Number.isSafeInteger(page) && page >= 1 ? page : undefined;
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "readSlideViewState",
                error,
                { target: "Slide", appId }
            );
            return undefined;
        }
    }

    private isUnifiedAppSceneConfirmed(appId: string, page: number): boolean {
        try {
            const app = this.queryOne(appId);
            const view = app?.view;
            if (!app || !view) return false;
            const expectedPath = app.getFullScenePath();
            if (
                typeof expectedPath !== "string" ||
                expectedPath.length === 0 ||
                expectedPath !== view.focusScenePath
            )
                return false;
            if (this.getUnifiedAppKind(app.kind) === PresentationAppKind) {
                return this.readUnifiedAppPageState(appId, PresentationAppKind)?.page === page;
            }
            return view.focusSceneIndex !== undefined && view.focusSceneIndex + 1 === page;
        } catch (error) {
            this.logUnifiedPageException(
                this.unifiedPageStateKey(appId),
                "confirmScenePath",
                error,
                { appId, page }
            );
            return false;
        }
    }

    /**
     * 关闭 APP
     */
    public async closeApp(appId: string): Promise<void> {
        return this.appManager?.closeApp(appId);
    }

    /**
     * 切换 focus 到指定的 app, 并且把这个 app 放到最前面
     */
    public focusApp(appId: string) {
        const box = this.boxManager?.getBox(appId);
        if (box) {
            this.boxManager?.focusBox({ appId }, false);
            // 1.0 版本这里会有正式的 api
            (this.boxManager?.teleBoxManager as any).makeBoxTop(box, false);
        }
    }

    public moveCamera(
        camera: Partial<Camera> & { animationMode?: AnimationMode | undefined }
    ): void {
        if (this.originSize) {
            this.appManager?.mainViewProxy.moveCameraByApi(camera);
            return;
        }
        const pureCamera = omit(camera, ["animationMode"]);
        const mainViewCamera = { ...this.mainView.camera };
        if (isEqual({ ...mainViewCamera, ...pureCamera }, mainViewCamera)) return;
        this.mainView.moveCamera(camera);
        setTimeout(() => {
            this.appManager?.mainViewProxy.setCameraAndSize();
        }, 500);
    }

    public moveCameraToContain(
        rectangle: Rectangle &
            Readonly<{
                animationMode?: AnimationMode;
            }>
    ): void {
        if (this.originSize) {
            this.appManager?.mainViewProxy.moveCameraToContainByApi(rectangle);
            return;
        }
        this.mainView.moveCameraToContain(rectangle);
        setTimeout(() => {
            this.appManager?.mainViewProxy.setCameraAndSize();
        }, 500);
    }

    public convertToPointInWorld(point: Point): Point {
        return this.mainView.convertToPointInWorld(point);
    }

    public setCameraBound(cameraBound: CameraBound): void {
        const { damping, centerX, centerY, width, height } = cameraBound;
        this.Logger?.info(
            `[WindowManager]: setCameraBound ${JSON.stringify({
                damping,
                centerX,
                centerY,
                width,
                height,
                hasMaxContentMode: typeof cameraBound.maxContentMode === "function",
                hasMinContentMode: typeof cameraBound.minContentMode === "function",
                originSize: this.originSize,
                mainViewSize: this.appManager?.mainViewProxy.view.size,
            })}`
        );
        this.appManager?.mainViewProxy.setCameraBoundByApi(cameraBound);
    }

    public fitOriginSizeAndCamera(): void {
        this.appManager?.mainViewProxy.fitOriginSizeAndCamera();
    }

    public override onDestroy(): void {
        this._destroy();
    }

    public override destroy(): void {
        this._destroy();
    }

    private _destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._unifiedPageControl.destroy();
        this.finishDestroy();
    }

    private finishDestroy() {
        this.attributesDeboundceLog?.destroy();
        this.attributesDeboundceLog = undefined;
        this.containerResizeObserver?.disconnect();
        this.appManager?.destroy();
        this.cursorManager?.destroy();
        this.extendPluginManager?.destroy();
        WindowManager.container = undefined;
        WindowManager.wrapper = undefined;
        WindowManager.sizer = undefined;
        WindowManager.isCreated = false;
        if (WindowManager.playground) {
            WindowManager.playground.parentNode?.removeChild(WindowManager.playground);
        }
        WindowManager.params = undefined;
        this.emitter.off("mainViewScenePathChange", this.onMainViewScenePathChangeHandler);
        this._iframeBridge?.destroy();
        this._iframeBridge = undefined;
        log("Destroyed");
    }

    private bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean | undefined) {
        if (this.appManager) {
            this.appManager.bindMainView(divElement, Boolean(disableCameraTransform));
            this.cursorManager?.setMainViewDivElement(divElement);
        }
    }

    public get canOperate(): boolean {
        if (isRoom(this.displayer)) {
            return (
                (this.displayer as Room).isWritable &&
                (this.displayer as Room).phase === RoomPhase.Connected
            );
        } else {
            return false;
        }
    }

    public get room(): Room {
        return this.displayer as Room;
    }

    public safeSetAttributes(attributes: any): void {
        if (this.canOperate) {
            this.setAttributes(attributes);
            if (this.attributesDeboundceLog) {
                this.attributesDeboundceLog.logDebouncedShallowMerge(
                    "safeSetAttributes",
                    attributes
                );
            }
        }
    }

    public safeUpdateAttributes(keys: string[], value: any): void {
        if (this.canOperate) {
            this.updateAttributes(keys, value);
            if (this.attributesDeboundceLog) {
                this.attributesDeboundceLog.logDebouncedUpdateAttributes(keys, value);
            }
        }
    }

    public setPrefersColorScheme(scheme: TeleBoxColorScheme): void {
        this.appManager?.boxManager?.setPrefersColorScheme(scheme);
    }

    public cleanCurrentScene(): void {
        log("clean current scene");
        this.focusedView?.cleanCurrentScene();
        this.Logger &&
            this.Logger.info(
                `[WindowManager]: cleanCurrentScene ${this.focusedView?.focusScenePath}`
            );
    }

    public redo(): number {
        return this.focusedView?.redo() || 0;
    }

    public undo(): number {
        return this.focusedView?.undo() || 0;
    }

    public delete(): void {
        this.focusedView?.delete();
        this.Logger &&
            this.Logger.info(`[WindowManager]: delete ${this.focusedView?.focusScenePath}`);
    }

    public copy(): void {
        this.focusedView?.copy();
    }

    public paste(): void {
        this.focusedView?.paste();
    }

    public duplicate(): void {
        this.focusedView?.duplicate();
    }

    public insertText(x: number, y: number, text: string | undefined): string {
        return this.focusedView?.insertText(x, y, text) || "";
    }

    public insertImage(info: ImageInformation): void {
        return this.focusedView?.insertImage(info);
    }

    public completeImageUpload(uuid: string, url: string): void {
        return this.focusedView?.completeImageUpload(uuid, url);
    }

    public lockImage(uuid: string, locked: boolean): void {
        return this.focusedView?.lockImage(uuid, locked);
    }

    public lockImages(locked: boolean): void {
        return this.focusedView?.lockImages(locked);
    }

    public refresh() {
        this._refresh();
        this.appManager?.dispatchInternalEvent(Events.Refresh);
    }

    /** @internal */
    public _refresh() {
        this.appManager?.mainViewProxy.rebind();
        if (WindowManager.container) {
            this.bindContainer(WindowManager.container);
        }
        this.appManager?.refresher.refresh();
    }

    public setContainerSizeRatio(ratio: number) {
        if (
            !isNumber(ratio) ||
            !(ratio > 0) ||
            (this.originSize !== undefined && !Number.isFinite(ratio))
        ) {
            throw new Error(
                `[WindowManager]: updateContainerSizeRatio error, ratio must be a positive number. but got ${ratio}`
            );
        }
        WindowManager.containerSizeRatio = ratio;
        this.containerSizeRatio = ratio;
        internalEmitter.emit("containerSizeRatioUpdate", ratio);
    }

    private ensureOriginCameraCompatibility(): void {
        if (!this.originSize) return;
        const attributes = this.attributes || {};
        const originCamera = attributes[Fields.OriginCamera];
        const originSize = attributes[Fields.OriginSize];
        const mainViewCamera = attributes[Fields.MainViewCamera];
        const mainViewSize = attributes[Fields.MainViewSize];
        const version = attributes[Fields.MainViewCameraCoordinateVersion];
        const values = [originCamera, originSize, mainViewCamera, mainViewSize, version];
        if (values.every(value => value === undefined)) return;

        if (
            isLegacyMainViewCameraContract(
                originCamera,
                originSize,
                mainViewCamera,
                mainViewSize,
                version
            )
        ) {
            if (this.canOperate) {
                const id = this.room.uid;
                this.safeSetAttributes({
                    [Fields.OriginCamera]: { centerX: 0, centerY: 0, scale: 1, id },
                    [Fields.OriginSize]: { ...this.originSize, id },
                    [Fields.MainViewCamera]: { ...mainViewCamera },
                    [Fields.MainViewSize]: { ...mainViewSize },
                    [Fields.MainViewCameraCoordinateVersion]: MAIN_VIEW_CAMERA_COORDINATE_VERSION,
                });
            }
            return;
        }

        if (values.some(value => value === undefined)) {
            throw new Error(
                "[WindowManager]: originSize mode attributes must contain a complete origin and mainView camera contract"
            );
        }
        if (version !== MAIN_VIEW_CAMERA_COORDINATE_VERSION) {
            throw new Error(
                `[WindowManager]: originSize cannot be enabled for legacy mainView camera attributes (coordinate version: ${String(
                    version
                )})`
            );
        }
        if (!isSameOriginSize(originSize, this.originSize)) {
            throw new Error(
                `[WindowManager]: room originSize ${JSON.stringify(
                    originSize
                )} does not match local originSize ${JSON.stringify(this.originSize)}`
            );
        }
        if (
            !isValidCamera(originCamera) ||
            originCamera.centerX !== 0 ||
            originCamera.centerY !== 0 ||
            originCamera.scale !== 1
        ) {
            throw new Error(
                `[WindowManager]: room originCamera is invalid in originSize mode: ${JSON.stringify(
                    originCamera
                )}`
            );
        }
        if (!isValidSize(mainViewSize)) {
            throw new Error(
                `[WindowManager]: room mainViewSize is invalid in originSize mode: ${JSON.stringify(
                    mainViewSize
                )}`
            );
        }
        if (!isValidCamera(mainViewCamera)) {
            throw new Error(
                `[WindowManager]: room mainViewCamera is invalid in originSize mode: ${JSON.stringify(
                    mainViewCamera
                )}`
            );
        }
    }

    private isDynamicPPT(scenes: SceneDefinition[]) {
        const sceneSrc = scenes[0]?.ppt?.src;
        return sceneSrc?.startsWith("pptx://");
    }

    private async ensureAttributes() {
        if (isNull(this.attributes)) {
            await wait(50);
        }
        if (isObject(this.attributes)) {
            if (!this.attributes[Fields.Apps]) {
                this.safeSetAttributes({ [Fields.Apps]: {} });
            }
            if (!this.attributes[Fields.Cursors]) {
                this.safeSetAttributes({ [Fields.Cursors]: {} });
            }
            if (!this.attributes["_mainScenePath"]) {
                this.safeSetAttributes({ _mainScenePath: INIT_DIR });
            }
            if (!this.attributes["_mainSceneIndex"]) {
                this.safeSetAttributes({ _mainSceneIndex: 0 });
            }
            if (!this.attributes[Fields.Registered]) {
                this.safeSetAttributes({ [Fields.Registered]: {} });
            }
            if (!this.attributes[Fields.IframeBridge]) {
                this.safeSetAttributes({ [Fields.IframeBridge]: {} });
            }
        }
    }

    private _iframeBridge?: IframeBridge;
    public getIframeBridge() {
        if (!this.appManager) {
            throw new Error("[WindowManager]: should call getIframeBridge() after await mount()");
        }
        this._iframeBridge || (this._iframeBridge = new IframeBridge(this, this.appManager));
        return this._iframeBridge;
    }

    public useExtendPlugin(extend: ExtendPluginInstance<any>) {
        this.extendPluginManager?.use(extend);
    }
}

setupBuiltin();

export * from "./typings";

export { BuiltinApps } from "./BuiltinApps";
export type { BuiltinAppOptions } from "./BuiltinApps";
export type { PublicEvent } from "./callback";

export * from "./ExtendPluginManager";
