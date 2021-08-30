import Emittery from 'emittery';
import {
    AppCreateError,
    AppManagerNotInitError,
    ParamsInvalidError,
    WhiteWebSDKInvalidError
} from './error';
import { AppListeners } from './AppListener';
import { AppManager } from './AppManager';
import {
    Displayer,
    InvisiblePlugin,
    InvisiblePluginContext,
    isRoom,
    Room,
    RoomPhase,
    SceneDefinition,
    View,
    ViewMode,
    ViewVisionMode,
    WhiteVersion
} from 'white-web-sdk';
import { log } from './log';
import { NetlessApp, RegisterParams } from './typings';
import { replaceRoomFunction } from './RoomHacker';
import { ResizeObserver as ResizeObserverPolyfill } from '@juggle/resize-observer';
import { setupWrapper } from './ViewManager';
import { TELE_BOX_STATE } from './BoxManager';
import './style.css';
import '@netless/telebox-insider/dist/style.css';
import {
    REQUIRE_VERSION,
    DEFAULT_CONTAINER_RATIO,
} from "./constants";
import { appRegister } from './Register';
import AppDocsViewer from '@netless/app-docs-viewer';
import AppMediaPlayer, { setOptions } from '@netless/app-media-player';

const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

export type WindowMangerAttributes = {
    modelValue?: string,
    boxState: TELE_BOX_STATE,
    [key: string]: any,
}

export type apps = {
    [key: string]: NetlessApp
}

export type AddAppOptions = {
    scenePath?: string;
    title?: string;
    scenes?: SceneDefinition[],
}

export type setAppOptions = AddAppOptions & { appOptions?: any };

export type AddAppParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
}

export type BaseInsertParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
    isDynamicPPT?: boolean;
}

export type AppSyncAttributes = {
    kind: string,
    src?: string,
    options: any,
    state?: any,
    isDynamicPPT?: boolean,
}

export type AppInitState = {
    id: string,
    x?: number,
    y?: number,
    width?: number,
    height?: number,
    focus?: boolean,
    snapshotRect?: any,
    boxState?: TELE_BOX_STATE,
    sceneIndex?: number,
}

export const emitter: Emittery<{
    onCreated: undefined;
    [key: string]: any
}> = new Emittery();

export type PublicEvent = {
    mainViewModeChange: ViewVisionMode,
    boxStateChange: `${TELE_BOX_STATE}`,
}

export const callbacks: Emittery<PublicEvent> = new Emittery();

export type MountParams = {
    room: Room,
    container: HTMLElement,
    /** 白板高宽比例, 默认为 9 / 16 */
    containerSizeRatio?: number,
    /** 显示 PS 透明背景，默认 true */
    chessboard?: boolean,
    collectorContainer?: HTMLElement,
    collectorStyles?: Partial<CSSStyleDeclaration>,
    debug?: boolean,
};

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static displayer: Displayer;
    public static wrapper: HTMLElement | null;
    public static debug = false;
    public static containerSizeRatio = DEFAULT_CONTAINER_RATIO;
    private static isCreated = false;

    public appListeners?: AppListeners;
    public static appClasses: Map<string, NetlessApp> = new Map();

    private appManager?: AppManager;
    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;

    constructor(context: InvisiblePluginContext) {
        super(context);
    }

    /**
     * 挂载 WindowManager
     */
    public static async mount(
        room: Room,
        container: HTMLElement,
        collectorContainer?: HTMLElement,
        options?: {
            chessboard: boolean
            containerSizeRatio: number,
            collectorStyles?: Partial<CSSStyleDeclaration>,
            debug?: boolean,
        }
    ): Promise<WindowManager>;

    public static async mount(params: MountParams): Promise<WindowManager>;

    public static async mount(
        params: MountParams | Room,
        container?: HTMLElement,
        collectorContainer?: HTMLElement,
        options?: {
            chessboard?: boolean
            containerSizeRatio: number,
            collectorStyles?: Partial<CSSStyleDeclaration>,
            debug?: boolean,
        }) {
        let room: Room;
        let containerSizeRatio: number | undefined;
        let collectorStyles: Partial<CSSStyleDeclaration> | undefined;
        let debug: boolean | undefined;
        let chessboard = true;
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
        } else {
            room = params;
            containerSizeRatio = options?.containerSizeRatio;
            collectorStyles = options?.collectorStyles;
            debug = options?.debug;
            if (options?.chessboard != null) {
                chessboard = options.chessboard;
            }
        }

        this.checkVersion();
        this.ensureEnableUseMobxState(room);
        if (!container) {
            throw new Error("[WindowManager]: Container must provide");
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        if (!manager) {
            manager = await room.createInvisiblePlugin(WindowManager, {}) as WindowManager;
        }
        this.debug = Boolean(debug);
        if (this.debug) {
            setOptions({ verbose: true });
        }
        if (containerSizeRatio) {
            WindowManager.containerSizeRatio = containerSizeRatio;
        }
        const { playground, wrapper, sizer, mainViewElement } = setupWrapper(container);
        if (chessboard) {
            sizer.classList.add('netless-window-manager-chess-sizer')
        }
        manager.appManager = new AppManager(manager, {
            collectorContainer: collectorContainer,
            collectorStyles: collectorStyles
        });
        manager.observePlaygroundSize(playground, sizer, wrapper)
        manager.bindMainView(mainViewElement);
        replaceRoomFunction(room, manager.appManager);
        emitter.emit("onCreated");
        WindowManager.isCreated = true;
        return manager;
    }

    /**
     * 注册插件
     */
    public static register(params: RegisterParams) {
        appRegister.register(params);
    }

    /**
     * 创建 main View
     */
    public createMainView(): View {
        if (this.appManager) {
            return this.appManager.viewManager.mainView!;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    /**
     * 创建一个 app 至白板
     */
    public async addApp(params: AddAppParams) {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new ParamsInvalidError();
            }
            const appImpl = WindowManager.appClasses.get(params.kind);
            if (appImpl && appImpl.config?.singleton) {
                if (this.appManager.appProxies.has(params.kind)) {
                    throw new AppCreateError();
                }
            }
            let isDynamicPPT = false;
            if (params.options) {
                const { scenePath, scenes } = params.options;
                if (scenePath) {
                    for (const appId in this.apps) {
                        const appScenePath = this.appManager.delegate.getAppScenePath(appId);
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

            const appId = await this.appManager.addApp(params, isDynamicPPT);
            return appId
        } else {
            throw new AppManagerNotInitError();
        }
    }

    /**
     * 关闭 APP
     */
    public async closeApp(appId: string) {
        return this.appManager?.closeApp(appId);
    }

    /**
     * 设置 mainView 的 ScenePath, 并且切换白板为可写状态
     */
    public setMainViewScenePath(scenePath: string) {
        if (this.appManager) {
            this.appManager.setMainViewScenePath(scenePath);
        }
    }

    /**
     * 设置 mainView 的 SceneIndex, 并且切换白板为可写状态
     */
    public setMainViewSceneIndex(index: number) {
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
    public setReadonly(readonly: boolean) {
        if (this.room?.isWritable) {
            this.readonly = readonly;
            this.appManager?.boxManager.teleBoxManager.setReadonly(readonly);
        }
    }

    /**
     * 切换 mainView 为可写
     */
    public switchMainViewToWriter() {
        return this.appManager?.viewManager.mainViewClickHandler();
    }

    /**
     * app destroy 回调
    */
    public onAppDestroy(kind: string, listener: (error: Error) => void) {
        emitter.once(`destroy-${kind}`).then(listener);
    }

    /**
     * 设置 ViewMode
     */
    public setViewMode(mode: ViewMode) {
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

    public get mainView() {
        return this.appManager!.viewManager.mainView;
    }

    public get camera() {
        return this.appManager!.viewManager.mainView.camera;
    }

    public get apps() {
        return this.appManager?.delegate.apps();
    }

    public get boxState() {
        return this.appManager?.boxManager.teleBoxManager.state;
    }

    public onDestroy() {
        this._destroy();
    }

    public destroy() {
        this._destroy();
    }

    private _destroy() {
        this.containerResizeObserver?.disconnect()
        this.appManager?.destroy();
        WindowManager.isCreated = false;
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

            if (this.appManager.delegate.focus === undefined && mainView.mode !== ViewVisionMode.Writable) {
                this.appManager.viewManager.freedomAllViews();
                this.appManager.viewManager.switchMainViewToWriter();
            }
            this.appManager.viewManager.addMainViewListener();
        }
    }

    public get canOperate() {
        if (isRoom(this.displayer)) {
            return (this.displayer as Room).isWritable && (this.displayer as Room).phase === RoomPhase.Connected;
        } else {
            return false;
        }
    }

    public get room() {
        return this.canOperate ? (this.displayer as Room) : undefined;
    }

    public safeSetAttributes(attributes: any) {
        if (this.canOperate) {
            this.setAttributes(attributes);
        }
    }

    public safeUpdateAttributes(keys: string[], value: any) {
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
            return scenes[index]?.name
        }
    }

    private isDynamicPPT(scenes: SceneDefinition[]) {
        const sceneSrc = scenes[0]?.ppt?.src;
        return sceneSrc?.startsWith("pptx://");
    }

    private static checkVersion() {
        const version = this.getVersionNumber(WhiteVersion);
        if (version < this.getVersionNumber(REQUIRE_VERSION)) {
            throw new WhiteWebSDKInvalidError(REQUIRE_VERSION);
        }
    }

    private static getVersionNumber(version: string) {
        return parseInt(version.split(".").join(""));
    }

    private static ensureEnableUseMobxState(room: Room) {
        // @ts-ignore
        if (room.useMobXState === false) {
            console.warn("[Window Manager]: will enable useMobxState. To turn off this warning, set useMobxState: true when initializing WhiteWebSdk.");
            // @ts-ignore
            room.useMobXState = true;
        }
    }

    private containerResizeObserver?: ResizeObserver

    private observePlaygroundSize(container: HTMLElement, sizer: HTMLElement, wrapper: HTMLDivElement) {
        this.updateSizer(container.getBoundingClientRect(), sizer, wrapper)

        this.containerResizeObserver = new ResizeObserver((entries) => {
            const containerRect = entries[0]?.contentRect;
            if (containerRect) {
                this.updateSizer(containerRect, sizer, wrapper)
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
                sizer.classList.toggle('netless-window-manager-sizer-horizontal', true)
            } else {
                width = height / WindowManager.containerSizeRatio;
                sizer.classList.toggle('netless-window-manager-sizer-horizontal', false)
            }
            wrapper.style.width = `${width}px`;
            wrapper.style.height = `${height}px`;
        }
    }
}

WindowManager.register({
    kind: AppDocsViewer.kind,
    src: AppDocsViewer
});
WindowManager.register({
    kind: AppMediaPlayer.kind,
    src: AppMediaPlayer
});

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: AppMediaPlayer.kind as string,
}

export * from "./typings";

