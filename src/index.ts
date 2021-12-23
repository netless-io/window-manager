import AppDocsViewer from "@netless/app-docs-viewer";
import AppMediaPlayer, { setOptions } from "@netless/app-media-player";
import Emittery from "emittery";
import pRetry from "p-retry";
import { AppManager } from "./AppManager";
import { appRegister } from "./Register";
import { CursorManager } from "./Cursor";
import { DEFAULT_CONTAINER_RATIO, REQUIRE_VERSION } from "./constants";
import { Fields } from "./AttributesDelegate";
import { initDb } from "./Register/storage";
import { isNull, isObject } from "lodash";
import { log } from "./Utils/log";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
import { setupWrapper } from "./ViewManager";
import "./style.css";
import "@netless/telebox-insider/dist/style.css";
import {
    addEmitterOnceListener,
    ensureValidScenePath,
    getVersionNumber,
    isValidScenePath,
    wait,
} from "./Utils/Common";
import type { TELE_BOX_STATE } from "./BoxManager";
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

const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

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

export type AddAppParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
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
};

export const emitter: Emittery<EmitterEvent> = new Emittery();

export type PublicEvent = {
    mainViewModeChange: ViewVisionMode;
    boxStateChange: `${TELE_BOX_STATE}`;
    darkModeChange: boolean;
    prefersColorSchemeChange: TeleBoxColorScheme;
    cameraStateChange: CameraState;
};

export type MountParams = {
    room: Room;
    container: HTMLElement;
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

export const callbacks: Emittery<PublicEvent> = new Emittery();

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind = "WindowManager";
    public static displayer: Displayer;
    public static wrapper?: HTMLElement;
    public static playground?: HTMLElement;
    public static container?: HTMLElement;
    public static debug = false;
    public static containerSizeRatio = DEFAULT_CONTAINER_RATIO;
    private static isCreated = false;

    public version = "0.3.16";

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    public appManager?: AppManager;
    public cursorManager?: CursorManager;
    public viewMode = ViewMode.Broadcaster;
    public isReplay = isPlayer(this.displayer);

    constructor(context: InvisiblePluginContext) {
        super(context);
    }

    /**
     * 挂载 WindowManager
     * @deprecated
     */
    public static async mount(
        room: Room,
        container: HTMLElement,
        collectorContainer?: HTMLElement,
        options?: {
            chessboard: boolean;
            containerSizeRatio: number;
            collectorStyles?: Partial<CSSStyleDeclaration>;
            debug?: boolean;
            overwriteStyles?: string;
        }
    ): Promise<WindowManager>;

    public static async mount(params: MountParams): Promise<WindowManager>;

    public static async mount(
        params: MountParams | Room,
        container?: HTMLElement,
        collectorContainer?: HTMLElement,
        options?: {
            chessboard?: boolean;
            containerSizeRatio: number;
            collectorStyles?: Partial<CSSStyleDeclaration>;
            debug?: boolean;
            overwriteStyles?: string;
            disableCameraTransform?: boolean;
        }
    ): Promise<WindowManager> {
        let room: Room;
        let containerSizeRatio: number | undefined;
        let collectorStyles: Partial<CSSStyleDeclaration> | undefined;
        let debug: boolean | undefined;
        let chessboard = true;
        let overwriteStyles: string | undefined;
        let cursor: boolean | undefined;
        let disableCameraTransform = false;
        let prefersColorScheme: TeleBoxColorScheme | undefined = "light";
        if ("room" in params) {
            room = params.room;
            container = params.container;
            collectorContainer = params.collectorContainer;
            containerSizeRatio = params.containerSizeRatio;
            collectorStyles = params.collectorStyles;
            debug = params.debug;
            if (params.chessboard != null) {
                chessboard = params.chessboard;
            }
            overwriteStyles = params.overwriteStyles;
            cursor = params.cursor;
            disableCameraTransform = Boolean(params?.disableCameraTransform);
            prefersColorScheme = params.prefersColorScheme;
        } else {
            room = params;
            containerSizeRatio = options?.containerSizeRatio;
            collectorStyles = options?.collectorStyles;
            debug = options?.debug;
            if (options?.chessboard != null) {
                chessboard = options.chessboard;
            }
            overwriteStyles = options?.overwriteStyles;
        }

        this.checkVersion();
        if (isRoom(room)) {
            if (room.phase !== RoomPhase.Connected) {
                throw new Error("[WindowManager]: Room only Connected can be mount");
            }
        }
        if (!container) {
            throw new Error("[WindowManager]: Container must provide");
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        let manager = await this.initManager(room);
        this.debug = Boolean(debug);
        if (this.debug) {
            setOptions({ verbose: true });
        }
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
        WindowManager.container = container;
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
        await manager.ensureAttributes();
        manager.appManager = new AppManager(manager, {
            collectorContainer: collectorContainer,
            collectorStyles: collectorStyles,
            prefersColorScheme: prefersColorScheme,
        });
        manager.observePlaygroundSize(playground, sizer, wrapper);
        if (cursor) {
            manager.cursorManager = new CursorManager(manager.appManager);
        }
        manager.bindMainView(mainViewElement, disableCameraTransform);
        replaceRoomFunction(room, manager.appManager);
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
    public async addApp(params: AddAppParams): Promise<string | undefined> {
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
    public getMainViewScenePath(): string {
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
        if (this.room?.isWritable) {
            this.readonly = readonly;
            this.appManager?.boxManager.setReadonly(readonly);
        }
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

    public get boxState(): TeleBoxState {
        if (this.appManager) {
            return this.appManager.boxManager.boxState;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get darkMode(): boolean {
        return Boolean(this.appManager?.boxManager.darkMode);
    }

    public get prefersColorScheme(): TeleBoxColorScheme {
        if (this.appManager) {
            return this.appManager.boxManager.prefersColorScheme;
        } else {
            throw new AppManagerNotInitError();
        }
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
        log("Destroyed");
    }

    private bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean) {
        if (this.appManager) {
            this.appManager.bindMainView(divElement, disableCameraTransform);
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
        this.appManager?.boxManager.setPrefersColorScheme(scheme);
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

    private containerResizeObserver?: ResizeObserver;

    private observePlaygroundSize(
        container: HTMLElement,
        sizer: HTMLElement,
        wrapper: HTMLDivElement
    ) {
        this.updateSizer(container.getBoundingClientRect(), sizer, wrapper);

        this.containerResizeObserver = new ResizeObserver(entries => {
            const containerRect = entries[0]?.contentRect;
            if (containerRect) {
                this.updateSizer(containerRect, sizer, wrapper);
                this.cursorManager?.updateContainerRect();
                this.appManager?.boxManager.updateManagerRect();
                emitter.emit("playgroundSizeChange", containerRect);
            }
        });

        this.containerResizeObserver.observe(container);
    }

    private updateSizer(
        { width, height }: DOMRectReadOnly,
        sizer: HTMLElement,
        wrapper: HTMLDivElement
    ) {
        if (width && height) {
            if (height / width > WindowManager.containerSizeRatio) {
                height = width * WindowManager.containerSizeRatio;
                sizer.classList.toggle("netless-window-manager-sizer-horizontal", true);
            } else {
                width = height / WindowManager.containerSizeRatio;
                sizer.classList.toggle("netless-window-manager-sizer-horizontal", false);
            }
            wrapper.style.width = `${width}px`;
            wrapper.style.height = `${height}px`;
        }
    }
}

WindowManager.register({
    kind: AppDocsViewer.kind,
    src: AppDocsViewer,
});
WindowManager.register({
    kind: AppMediaPlayer.kind,
    src: AppMediaPlayer,
});

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: AppMediaPlayer.kind as string,
};

export * from "./typings";

export { WhiteWindowSDK } from "./sdk";
