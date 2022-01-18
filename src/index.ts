import Emittery from "emittery";
import pRetry from "p-retry";
import { AppManager } from "./AppManager";
import { appRegister } from "./Register";
import { ContainerResizeObserver } from "./ContainerResizeObserver";
import { createBoxManager } from "./BoxManager";
import { CursorManager } from "./Cursor";
import { DEFAULT_CONTAINER_RATIO, Events, REQUIRE_VERSION } from "./constants";
import { Fields } from "./AttributesDelegate";
import { initDb } from "./Register/storage";
import { isNull, isObject } from "lodash";
import { log } from "./Utils/log";
import { ReconnectRefresher } from "./ReconnectRefresher";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { setupBuiltin } from "./BuiltinApps";
import { setupWrapper } from "./Helper";
import "./style.css";
import "@netless/telebox-insider/dist/style.css";
import {
    addEmitterOnceListener,
    ensureValidScenePath,
    getVersionNumber,
    isValidScenePath,
    parseSceneDir,
    wait,
} from "./Utils/Common";
import type { TELE_BOX_STATE, BoxManager } from "./BoxManager";
import {
    AppCreateError,
    AppManagerNotInitError,
    InvalidScenePath,
    ParamsInvalidError,
    WhiteWebSDKInvalidError,
} from "./Utils/error";
import type { Apps } from "./AttributesDelegate";
import {
    InvisiblePlugin,
    isPlayer,
    isRoom,
    RoomPhase,
    ViewMode,
    WhiteVersion,
} from "white-web-sdk";
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
    ViewVisionMode,
    CameraState,
} from "white-web-sdk";
import type { AppListeners } from "./AppListener";
import type { NetlessApp, RegisterParams } from "./typings";
import type { TeleBoxColorScheme, TeleBoxState } from "@netless/telebox-insider";
import type { AppProxy } from "./AppProxy";

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

export type AddAppParams<TAttributes = any> = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: TAttributes;
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
};

export type AppSyncAttributes = {
    kind: string;
    src?: string;
    options: any;
    state?: any;
    isDynamicPPT?: boolean;
    fullPath?: string;
    createdAt?: number;
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
    boxState?: TeleBoxState; // 兼容旧版 telebox
    zIndex?: number;
};

export type EmitterEvent = {
    onCreated: undefined;
    InitReplay: AppInitState;
    move: { appId: string; x: number; y: number };
    focus: { appId: string };
    close: { appId: string };
    resize: { appId: string; width: number; height: number; x?: number; y?: number };
    error: Error;
    seek: number;
    mainViewMounted: undefined;
    observerIdChange: number;
    boxStateChange: string;
    playgroundSizeChange: DOMRect;
    onReconnected: void;
    removeScenes: string;
};

export type EmitterType = Emittery<EmitterEvent>;
export const emitter: EmitterType = new Emittery();

export type PublicEvent = {
    mainViewModeChange: ViewVisionMode;
    boxStateChange: `${TELE_BOX_STATE}`;
    darkModeChange: boolean;
    prefersColorSchemeChange: TeleBoxColorScheme;
    cameraStateChange: CameraState;
    mainViewScenePathChange: string;
    mainViewSceneIndexChange: number;
    focusedChange: string | undefined;
};

export type MountParams = {
    room: Room;
    container?: HTMLElement;
    /** 白板高宽比例, 默认为 9 / 16 */
    containerSizeRatio?: number;
    /** 显示 PS 透明背景，默认 true */
    chessboard?: boolean;
    collectorContainer?: HTMLElement;
    collectorStyles?: Partial<CSSStyleDeclaration>;
    overwriteStyles?: string;
    cursor?: boolean;
    debug?: boolean;
    disableCameraTransform?: boolean;
    prefersColorScheme?: TeleBoxColorScheme;
};

export type CallbacksType = Emittery<PublicEvent>;
export const callbacks: CallbacksType = new Emittery();

export const reconnectRefresher = new ReconnectRefresher({ emitter });

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind = "WindowManager";
    public static displayer: Displayer;
    public static wrapper?: HTMLElement;
    public static playground?: HTMLElement;
    public static container?: HTMLElement;
    public static debug = false;
    public static containerSizeRatio = DEFAULT_CONTAINER_RATIO;
    private static isCreated = false;

    public version = __APP_VERSION__;
    public dependencies = __APP_DEPENDENCIES__;

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    public appManager?: AppManager;
    public cursorManager?: CursorManager;
    public viewMode = ViewMode.Broadcaster;
    public isReplay = isPlayer(this.displayer);

    private boxManager?: BoxManager;
    private static params?: MountParams;

    private containerResizeObserver?: ContainerResizeObserver;

    constructor(context: InvisiblePluginContext) {
        super(context);
        WindowManager.displayer = context.displayer;
        (window as any).NETLESS_DEPS = __APP_DEPENDENCIES__;
    }

    public static async mount(params: MountParams): Promise<WindowManager> {
        const room = params.room;
        WindowManager.container = params.container;
        const containerSizeRatio = params.containerSizeRatio;
        const debug = params.debug;

        const cursor = params.cursor;
        WindowManager.params = params;

        this.checkVersion();
        if (isRoom(room)) {
            if (room.phase !== RoomPhase.Connected) {
                throw new Error("[WindowManager]: Room only Connected can be mount");
            }
            if (room.phase === RoomPhase.Connected && room.isWritable) {
                // redo undo 需要设置这个属性
                room.disableSerialization = false;
            }
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        let manager = await this.initManager(room);
        this.debug = Boolean(debug);
        log("Already insert room", manager);

        if (isRoom(this.displayer)) {
            if (!manager) {
                throw new Error("[WindowManager]: init InvisiblePlugin failed");
            }
        } else {
            await pRetry(
                async count => {
                    manager = await this.initManager(room);
                    if (!manager) {
                        log(`manager is empty. retrying ${count}`);
                        throw new Error();
                    }
                },
                { retries: 10 }
            );
        }

        if (containerSizeRatio) {
            WindowManager.containerSizeRatio = containerSizeRatio;
        }
        await manager.ensureAttributes();

        manager.appManager = new AppManager(manager);

        if (cursor) {
            manager.cursorManager = new CursorManager(manager.appManager);
        }

        if (params.container) {
            manager.bindContainer(params.container);
        }

        replaceRoomFunction(room, manager);
        emitter.emit("onCreated");
        WindowManager.isCreated = true;
        try {
            await initDb();
        } catch (error) {
            console.warn("[WindowManager]: indexedDB open failed");
            console.log(error);
        }
        return manager;
    }

    private static async initManager(room: Room): Promise<WindowManager> {
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        if (!manager) {
            if (isRoom(room)) {
                if (room.isWritable === false) {
                    try {
                        await room.setWritable(true);
                    } catch (error) {
                        throw new Error("[WindowManger]: room must be switched to be writable");
                    }
                    manager = (await room.createInvisiblePlugin(
                        WindowManager,
                        {}
                    )) as WindowManager;
                    manager.ensureAttributes();
                    await wait(500);
                    await room.setWritable(false);
                } else {
                    manager = (await room.createInvisiblePlugin(
                        WindowManager,
                        {}
                    )) as WindowManager;
                }
            }
        }
        return manager;
    }

    private static initContainer(
        manager: WindowManager,
        container: HTMLElement,
        chessboard: boolean | undefined,
        overwriteStyles: string | undefined
    ) {
        if (!WindowManager.container) {
            WindowManager.container = container;
        }
        const { playground, wrapper, sizer, mainViewElement } = setupWrapper(container);
        WindowManager.playground = playground;
        if (chessboard) {
            sizer.classList.add("netless-window-manager-chess-sizer");
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
            emitter
        );
        WindowManager.wrapper = wrapper;
        return mainViewElement;
    }

    public bindContainer(container: HTMLElement) {
        if (WindowManager.isCreated && WindowManager.container) {
            if (WindowManager.container.firstChild) {
                container.appendChild(WindowManager.container.firstChild);
            }
        } else {
            if (WindowManager.params) {
                const params = WindowManager.params;
                const mainViewElement = WindowManager.initContainer(
                    this,
                    container,
                    params.chessboard,
                    params.overwriteStyles
                );
                const boxManager = createBoxManager(this, callbacks, emitter, {
                    collectorContainer: params.collectorContainer,
                    collectorStyles: params.collectorStyles,
                    prefersColorScheme: params.prefersColorScheme,
                });
                this.boxManager = boxManager;
                this.appManager?.setBoxManager(boxManager);
                this.bindMainView(mainViewElement, params.disableCameraTransform);
                if (WindowManager.wrapper) {
                    this.cursorManager?.setupWrapper(WindowManager.wrapper);
                }
            }
        }
        this.boxManager?.updateManagerRect();
        this.appManager?.refresh();
        this.appManager?.resetMaximized();
        this.appManager?.resetMinimized();
        WindowManager.container = container;
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
    public static register<AppOptions = any, SetupResult = any, Attributes = any>(
        params: RegisterParams<AppOptions, SetupResult, Attributes>
    ): Promise<void> {
        return appRegister.register(params);
    }

    /**
     * 创建一个 app 至白板
     */
    public async addApp<T = any>(params: AddAppParams<T>): Promise<string | undefined> {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new ParamsInvalidError();
            }
            const appImpl = await appRegister.appClasses.get(params.kind)?.();
            if (appImpl && appImpl.config?.singleton) {
                if (this.appManager.appProxies.has(params.kind)) {
                    throw new AppCreateError();
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
            throw new AppManagerNotInitError();
        }
    }

    private setupScenePath(params: AddAppParams, appManager: AppManager): boolean | undefined {
        let isDynamicPPT = false;
        if (params.options) {
            const { scenePath, scenes } = params.options;
            if (scenePath) {
                if (!isValidScenePath(scenePath)) {
                    throw new InvalidScenePath();
                }
                const apps = Object.keys(this.apps || {});
                for (const appId of apps) {
                    const appScenePath = appManager.store.getAppScenePath(appId);
                    if (appScenePath && appScenePath === scenePath) {
                        console.warn(`[WindowManager]: ScenePath ${scenePath} Already opened`);
                        if (this.boxManager) {
                            const topBox = this.boxManager.getTopBox();
                            if (topBox) {
                                this.boxManager.setZIndex(appId, topBox.zIndex + 1, false);
                            }
                        }
                        return;
                    }
                }
            }
            if (scenePath && scenes && scenes.length > 0) {
                if (this.isDynamicPPT(scenes)) {
                    isDynamicPPT = true;
                    if (!this.displayer.entireScenes()[scenePath]) {
                        this.room?.putScenes(scenePath, scenes);
                    }
                } else {
                    if (!this.displayer.entireScenes()[scenePath]) {
                        this.room?.putScenes(scenePath, [{ name: scenes[0].name }]);
                    }
                }
            }
            if (scenePath && scenes === undefined) {
                this.room?.putScenes(scenePath, [{}]);
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
     * 设置 ViewMode
     */
    public setViewMode(mode: ViewMode): void {
        if (!this.canOperate) return;
        if (mode === ViewMode.Broadcaster) {
            this.appManager?.mainViewProxy.setCameraAndSize();
            this.appManager?.mainViewProxy.start();
        }
        if (mode === ViewMode.Freedom) {
            this.appManager?.mainViewProxy.stop();
        }
        this.viewMode = mode;
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

    public get mainView(): View {
        if (this.appManager) {
            return this.appManager.mainViewProxy.view;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get camera(): Camera {
        if (this.appManager) {
            return this.appManager.mainViewProxy.view.camera;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get cameraState(): CameraState {
        if (this.appManager) {
            return this.appManager.mainViewProxy.cameraState;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get apps(): Apps | undefined {
        return this.appManager?.store.apps();
    }

    public get boxState(): TeleBoxState | undefined {
        if (this.appManager) {
            return this.appManager.boxManager?.boxState;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get darkMode(): boolean {
        return Boolean(this.appManager?.boxManager?.darkMode);
    }

    public get prefersColorScheme(): TeleBoxColorScheme | undefined {
        if (this.appManager) {
            return this.appManager.boxManager?.prefersColorScheme;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get focused(): string | undefined {
        return this.attributes.focus;
    }

    public get mainViewSceneIndex(): number {
        return this.appManager?.store.getMainViewSceneIndex();
    }

    public get mainViewSceneDir(): string {
        const scenePath = this.appManager?.store.getMainViewScenePath();
        if (scenePath) {
            return parseSceneDir(scenePath);
        } else {
            throw new Error("[WindowManager]: mainViewSceneDir not found");
        }
    }

    public get topApp(): string | undefined {
        return this.boxManager?.getTopBox()?.id;
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
     * 关闭 APP
     */
    public async closeApp(appId: string): Promise<void> {
        return this.appManager?.closeApp(appId);
    }

    public moveCamera(
        camera: Partial<Camera> & { animationMode?: AnimationMode | undefined }
    ): void {
        this.mainView.moveCamera(camera);
    }

    public moveCameraToContain(
        rectangle: Rectangle &
            Readonly<{
                animationMode?: AnimationMode;
            }>
    ): void {
        this.mainView.moveCameraToContain(rectangle);
        this.appManager?.dispatchInternalEvent(Events.MoveCameraToContain, rectangle);
        setTimeout(() => {
            this.appManager?.mainViewProxy.setCameraAndSize();
        }, 1000);
    }

    public convertToPointInWorld(point: Point): Point {
        return this.mainView.convertToPointInWorld(point);
    }

    public setCameraBound(cameraBound: CameraBound): void {
        this.mainView.setCameraBound(cameraBound);
    }

    public override onDestroy(): void {
        this._destroy();
    }

    public override destroy(): void {
        this._destroy();
    }

    private _destroy() {
        this.containerResizeObserver?.disconnect();
        this.appManager?.destroy();
        this.cursorManager?.destroy();
        WindowManager.container = undefined;
        WindowManager.wrapper = undefined;
        WindowManager.isCreated = false;
        if (WindowManager.playground) {
            WindowManager.playground.parentNode?.removeChild(WindowManager.playground);
        }
        WindowManager.params = undefined;
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
        }
    }

    public safeUpdateAttributes(keys: string[], value: any): void {
        if (this.canOperate) {
            this.updateAttributes(keys, value);
        }
    }

    public setPrefersColorScheme(scheme: TeleBoxColorScheme): void {
        this.appManager?.boxManager?.setPrefersColorScheme(scheme);
    }

    private isDynamicPPT(scenes: SceneDefinition[]) {
        const sceneSrc = scenes[0]?.ppt?.src;
        return sceneSrc?.startsWith("pptx://");
    }

    private static checkVersion() {
        const version = getVersionNumber(WhiteVersion);
        if (version < getVersionNumber(REQUIRE_VERSION)) {
            throw new WhiteWebSDKInvalidError(REQUIRE_VERSION);
        }
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
            const sceneState = this.displayer.state.sceneState;
            if (!this.attributes["_mainScenePath"]) {
                this.safeSetAttributes({ _mainScenePath: sceneState.scenePath });
            }
            if (!this.attributes["_mainSceneIndex"]) {
                this.safeSetAttributes({ _mainSceneIndex: sceneState.index });
            }
        }
    }

    private _removeScenes = (scenePath: string) => {
        this.room.removeScenes(scenePath);
    };
}

setupBuiltin();

export * from "./typings";

export { BuiltinApps } from "./BuiltinApps";
