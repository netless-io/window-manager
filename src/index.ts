import AppDocsViewer from "@netless/app-docs-viewer";
import AppMediaPlayer, { setOptions } from "@netless/app-media-player";
import Emittery from "emittery";
import { isNull, isObject } from "lodash";
import {
    AppCreateError,
    AppManagerNotInitError,
    ParamsInvalidError,
    WhiteWebSDKInvalidError,
} from "./Utils/error";
import { AppManager } from "./AppManager";
import { appRegister } from "./Register";
import { CursorManager } from "./Cursor";
import type { Apps } from "./AttributesDelegate";
import { Fields } from "./AttributesDelegate";
import { getVersionNumber, wait } from "./Utils/Common";
import {
    InvisiblePlugin,
    isRoom,
    RoomPhase,
    ViewMode,
    ViewVisionMode,
    WhiteVersion,
} from "white-web-sdk";
import { log } from "./Utils/log";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
import { setupWrapper } from "./ViewManager";
import "./style.css";
import "@netless/telebox-insider/dist/style.css";
import type {
    Displayer,
    SceneDefinition,
    View,
    Room,
    InvisiblePluginContext,
    Camera,
} from "white-web-sdk";
import type { AppListeners } from "./AppListener";
import type { NetlessApp, RegisterParams } from "./typings";
import type { TELE_BOX_STATE } from "./BoxManager";
import { REQUIRE_VERSION, DEFAULT_CONTAINER_RATIO } from "./constants";

const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

export type WindowMangerAttributes = {
    modelValue?: string;
    boxState: TELE_BOX_STATE;
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
};

export type AppInitState = {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    focus?: boolean;
    snapshotRect?: any;
    boxState?: TELE_BOX_STATE;
    sceneIndex?: number;
};

export const emitter: Emittery<{
    onCreated: undefined;
    [key: string]: any;
}> = new Emittery();

export type PublicEvent = {
    mainViewModeChange: ViewVisionMode;
    boxStateChange: `${TELE_BOX_STATE}`;
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

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    private appManager?: AppManager;
    public cursorManager?: CursorManager;

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
        }
    ): Promise<WindowManager> {
        let room: Room;
        let containerSizeRatio: number | undefined;
        let collectorStyles: Partial<CSSStyleDeclaration> | undefined;
        let debug: boolean | undefined;
        let chessboard = true;
        let overwriteStyles: string | undefined;
        let cursor: boolean | undefined;
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
        // this.ensureEnableUseMobxState(room);
        if (!container) {
            throw new Error("[WindowManager]: Container must provide");
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        if (!manager) {
            manager = (await room.createInvisiblePlugin(WindowManager, {})) as WindowManager;
        }
        this.debug = Boolean(debug);
        if (this.debug) {
            setOptions({ verbose: true });
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
        });
        manager.observePlaygroundSize(playground, sizer, wrapper);
        if (cursor) {
            manager.cursorManager = new CursorManager(manager, manager.appManager);
        }
        manager.bindMainView(mainViewElement);
        replaceRoomFunction(room, manager.appManager);
        emitter.emit("onCreated");
        WindowManager.isCreated = true;
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
     * 创建 main View
     */
    public createMainView(): View {
        if (this.appManager) {
            return this.appManager.viewManager.mainView;
        } else {
            throw new AppManagerNotInitError();
        }
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
                for (const appId in this.apps) {
                    const appScenePath = appManager.delegate.getAppScenePath(appId);
                    if (appScenePath && appScenePath === scenePath) {
                        console.warn(`ScenePath ${scenePath} Already opened`);
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
        }
        return isDynamicPPT;
    }

    /**
     * 关闭 APP
     */
    public async closeApp(appId: string): Promise<void> {
        return this.appManager?.closeApp(appId);
    }

    /**
     * 设置 mainView 的 ScenePath, 并且切换白板为可写状态
     */
    public setMainViewScenePath(scenePath: string): void {
        if (this.appManager) {
            this.appManager.setMainViewScenePath(scenePath);
        }
    }

    /**
     * 设置 mainView 的 SceneIndex, 并且切换白板为可写状态
     */
    public setMainViewSceneIndex(index: number): void {
        if (this.appManager) {
            this.appManager.setMainViewSceneIndex(index);
        }
    }

    /**
     * 返回 mainView 的 ScenePath
     */
    public getMainViewScenePath(): string {
        return this.appManager?.delegate.getMainViewScenePath();
    }

    /**
     * 返回 mainView 的 SceneIndex
     */
    public getMainViewSceneIndex(): number {
        return this.appManager?.delegate.getMainViewSceneIndex();
    }

    /**
     * 设置所有 app 的 readonly 模式
     */
    public setReadonly(readonly: boolean): void {
        if (this.room?.isWritable) {
            this.readonly = readonly;
            this.appManager?.boxManager.teleBoxManager.setReadonly(readonly);
        }
    }

    /**
     * 切换 mainView 为可写
     */
    public switchMainViewToWriter(): Promise<void> | undefined {
        return this.appManager?.viewManager.mainViewClickHandler();
    }

    /**
     * app destroy 回调
     */
    public onAppDestroy(kind: string, listener: (error: Error) => void): void {
        emitter.once(`destroy-${kind}`).then(listener);
    }

    /**
     * 设置 ViewMode
     */
    public setViewMode(mode: ViewMode): void {
        if (mode === ViewMode.Broadcaster) {
            this.appManager?.delegate.setBroadcaster(this.displayer.observerId);
            this.appManager?.delegate.setMainViewCamera(this.mainView.camera);
            this.appManager?.delegate.setMainViewSize(this.mainView.size);
        }
        if (mode === ViewMode.Freedom) {
            this.appManager?.delegate.setMainViewCamera(undefined);
            this.appManager?.delegate.setMainViewSize(undefined);
            this.appManager?.delegate.setBroadcaster(undefined);
        }
    }

    public get mainView(): View {
        if (this.appManager) {
            return this.appManager.viewManager.mainView;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get camera(): Camera {
        if (this.appManager) {
            return this.appManager.viewManager.mainView.camera;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get apps(): Apps | undefined {
        return this.appManager?.delegate.apps();
    }

    public get boxState(): string {
        if (this.appManager) {
            return this.appManager.boxManager.teleBoxManager.state;
        } else {
            throw new AppManagerNotInitError();
        }
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

    private bindMainView(divElement: HTMLDivElement) {
        if (this.appManager) {
            const mainView = this.appManager.viewManager.mainView;
            mainView.divElement = divElement;
            mainView.mode = ViewVisionMode.Writable;
            if (!mainView.focusScenePath) {
                this.appManager.delegate.setMainViewFocusPath();
            }
            if (!this.appManager.delegate.getMainViewScenePath()) {
                const sceneState = this.displayer.state.sceneState;
                this.appManager.delegate.setMainViewScenePath(sceneState.scenePath);
                this.appManager.delegate.setMainViewSceneIndex(sceneState.index);
            }

            if (
                this.appManager.delegate.focus === undefined &&
                mainView.mode !== ViewVisionMode.Writable
            ) {
                this.appManager.viewManager.freedomAllViews();
                this.appManager.viewManager.switchMainViewToWriter();
            }
            this.appManager.viewManager.addMainViewListener();
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

    public get room(): Room | undefined {
        return this.canOperate ? (this.displayer as Room) : undefined;
    }

    public get broadcaster(): number | undefined {
        return this.appManager?.delegate.broadcaster;
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

    private safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    private getSceneName(scenePath: string, index?: number) {
        const scenes = this.displayer.entireScenes()[scenePath];
        if (scenes && index !== undefined) {
            return scenes[index]?.name;
        }
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

    private static ensureEnableUseMobxState(room: Room) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (room.useMobXState === false) {
            console.warn(
                "[WindowManager]: will enable useMobxState. To turn off this warning, set useMobxState: true when initializing WhiteWebSdk."
            );
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            room.useMobXState = true;
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
