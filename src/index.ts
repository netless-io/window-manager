import pRetry from "p-retry";
import { AppManager } from "./AppManager";
import { appRegister } from "./Register";
import { callbacks } from "./callback";
import { checkVersion, createInvisiblePlugin, setupWrapper } from "./Helper";
import { createBoxManager } from "./BoxManager";
import { CursorManager } from "./Cursor";
import { DEFAULT_CONTAINER_RATIO, Events, INIT_DIR, ROOT_DIR } from "./constants";
import { emitter } from "./InternalEmitter";
import { Fields } from "./AttributesDelegate";
import { initDb } from "./Register/storage";
import { InvisiblePlugin, isPlayer, isRoom, RoomPhase, ViewMode } from "white-web-sdk";
import { isEqual, isNull, isObject, isNumber, omit } from "lodash";
import { log } from "./Utils/log";
import { PageStateImpl } from "./PageState";
import { ReconnectRefresher } from "./ReconnectRefresher";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { setupBuiltin } from "./BuiltinApps";
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
import { boxEmitter } from "./BoxEmitter";
import { Val } from "value-enhancer";
import type { TELE_BOX_STATE, BoxManager } from "./BoxManager";
import * as Errors from "./Utils/error";
import type { Apps, Position , ICamera, ISize } from "./AttributesDelegate";
import type {
    Displayer,
    SceneDefinition,
    View,
    Room,
    InvisiblePluginContext,
    Camera,
    CameraBound,
    Point,
    CameraState,
    Player,
    ImageInformation,
    SceneState,
    Size,
    AnimationMode, 
    Rectangle,
} from "white-web-sdk";
import type { AppListeners } from "./AppListener";
import type { ApplianceIcons, ManagerViewMode, MoveCameraParams, NetlessApp, RegisterParams } from "./typings";
import type { TeleBoxColorScheme, TeleBoxFullscreen, TeleBoxManager, TeleBoxManagerThemeConfig, TeleBoxState } from "@netless/telebox-insider";
import type { AppProxy } from "./App";
import type { PublicEvent } from "./callback";
import type Emittery from "emittery";
import type { PageController, AddPageParams, PageState } from "./Page";
import type { ScrollState } from "./View/ScrollMode";

export type WindowMangerAttributes = {
    modelValue?: string;
    boxState: TELE_BOX_STATE;
    maximized?: boolean;
    minimized?: boolean;
    scrollTop?: number;
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
    camera?: ICamera;
    size?: ISize;
    setup: boolean;
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
    visible?: boolean;
    stageRatio?: number;
    resizable?: boolean;
    draggable?: boolean;
    ratio?: number;
};

export type CursorMovePayload = { uid: string; state?: "leave"; position: Position };

export type MountParams = {
    room: Room | Player;
    container?: HTMLElement;
    /** 白板高宽比例, 默认为 9 / 16 */
    containerSizeRatio?: number;
    collectorContainer?: HTMLElement;
    collectorStyles?: Partial<CSSStyleDeclaration>;
    overwriteStyles?: string;
    cursor?: boolean;
    debug?: boolean;
    disableCameraTransform?: boolean;
    prefersColorScheme?: TeleBoxColorScheme;
    /** @deprecated */
    chessboard?: boolean;
    applianceIcons?: ApplianceIcons;
    containerStyle?: string;
    stageStyle?: string;
    fullscreen?: TeleBoxFullscreen;
    /** Custom `style` attribute value for content area of all boxes. Can be overwritten by box. */
    defaultBoxBodyStyle?: string | null;
    /** Custom `style` attribute value for stage area of all boxes. Can be overwritten by box. */
    defaultBoxStageStyle?: string | null;
    /** Theme variable */
    theme?: TeleBoxManagerThemeConfig;
    /** ScrollMode BaseWidth */
    scrollModeWidth?: number;
    /** ScrollMode BaseHeight */
    scrollModeHeight?: number;
    viewMode?: ManagerViewMode;
};

export const reconnectRefresher = new ReconnectRefresher({ emitter });

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes, any> implements PageController {
    public static kind = "WindowManager";
    public static displayer: Displayer;
    public static playground?: HTMLElement;
    public static container?: HTMLElement;
    public static debug = false;
    public static containerSizeRatio = DEFAULT_CONTAINER_RATIO;
    private static isCreated = false;
    public static registry = appRegister;

    public version = __APP_VERSION__;
    public dependencies = __APP_DEPENDENCIES__;

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    public appManager?: AppManager;
    public cursorManager?: CursorManager;
    public viewMode$ = new Val<ManagerViewMode>(ViewMode.Broadcaster);
    public playground$ = new Val<HTMLElement | undefined>(undefined);
    public isReplay = isPlayer(this.displayer);
    private _pageState?: PageStateImpl;

    private boxManager?: BoxManager;
    private static params?: MountParams;

    public containerSizeRatio = WindowManager.containerSizeRatio;

    constructor(context: InvisiblePluginContext) {
        super(context);
        WindowManager.displayer = context.displayer;
        (window as any).NETLESS_DEPS = __APP_DEPENDENCIES__;
    }

    public static async mount(params: MountParams): Promise<WindowManager> {
        const room = params.room;
        WindowManager.container = params.container;
        const debug = params.debug;
        const cursor = params.cursor;
        WindowManager.params = params;
        WindowManager.displayer = params.room;
        let manager: WindowManager | undefined = undefined;

        checkVersion();
        if (isRoom(room)) {
            if (room.phase !== RoomPhase.Connected) {
                throw new Error("[WindowManager]: Room only Connected can be mount");
            }
            if (room.phase === RoomPhase.Connected && room.isWritable) {
                // redo undo 需要设置这个属性
                room.disableSerialization = false;
            }
            manager = await this.initManager(room);
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }

        this.debug = Boolean(debug);
        log("Already insert room", manager);

        if (isRoom(this.displayer)) {
            if (!manager) {
                throw new Error("[WindowManager]: init InvisiblePlugin failed");
            }
        } else {
            await pRetry(
                async count => {
                    manager = (await room.getInvisiblePlugin(WindowManager.kind)) as WindowManager;
                    if (!manager) {
                        log(`manager is empty. retrying ${count}`);
                        throw new Error();
                    }
                },
                { retries: 10, maxTimeout: 5000 }
            );
        }

        if (!manager) {
            throw new Error("[WindowManager]: create manager failed");
        }

        if (params.containerSizeRatio) {
            WindowManager.containerSizeRatio = params.containerSizeRatio;
        }
        manager.containerSizeRatio = WindowManager.containerSizeRatio;
        await manager.ensureAttributes();
        if (params.viewMode) {
            manager.viewMode$.setValue(params.viewMode);
        }
        manager.appManager = new AppManager(manager);
        manager._pageState = new PageStateImpl(manager.appManager);
        manager.cursorManager = new CursorManager(manager.appManager, Boolean(cursor), params.applianceIcons);

        manager.boxManager = createBoxManager(manager, callbacks, emitter, boxEmitter, {
            collectorContainer: params.collectorContainer,
            collectorStyles: params.collectorStyles,
            prefersColorScheme: params.prefersColorScheme,
            stageRatio: WindowManager.containerSizeRatio,
            containerStyle: params.containerStyle,
            stageStyle: params.stageStyle,
            fullscreen: params.fullscreen,
            theme: params.theme,
        });
        manager.appManager?.setBoxManager(manager.boxManager);
        if (params.container) {
            manager.bindContainer(params.container);
        }

        if (params.scrollModeWidth && params.scrollModeHeight) {
            manager.appManager.scrollBaseSize$.setValue({ width: params.scrollModeWidth, height: params.scrollModeHeight });
        } 

        replaceRoomFunction(room, manager);
        emitter.emit("onCreated");
        WindowManager.isCreated = true;
        try {
            await initDb(appRegister);
        } catch (error) {
            console.warn("[WindowManager]: indexedDB open failed");
            console.log(error);
        }
        return manager;
    }

    private static async initManager(room: Room): Promise<WindowManager | undefined> {
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager | undefined;
        if (!manager) {
            if (isRoom(room)) {
                if (room.isWritable === false) {
                    try {
                        await room.setWritable(true);
                    } catch (error) {
                        throw new Error("[WindowManger]: room must be switched to be writable");
                    }
                    manager = await createInvisiblePlugin(room);
                    manager?.ensureAttributes();
                    await wait(500);
                    await room.setWritable(false);
                } else {
                    manager = await createInvisiblePlugin(room);
                }
            }
        }
        return manager;
    }

    private static initContainer(
        container: HTMLElement,
        target: HTMLElement,
        overwriteStyles: string | undefined
    ) {
        if (!WindowManager.container) {
            WindowManager.container = container;
        }
        const { playground, mainViewElement } = setupWrapper(container, target);
        WindowManager.playground = playground;
        if (overwriteStyles) {
            const style = document.createElement("style");
            style.textContent = overwriteStyles;
            playground.appendChild(style);
        }
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
            const teleboxContainer = this.boxManager?.teleBoxManager.$stage;
            if (WindowManager.params && teleboxContainer) {
                const params = WindowManager.params;
                const mainViewElement = WindowManager.initContainer(
                    container,
                    teleboxContainer,
                    params.overwriteStyles
                );
                if (this.boxManager && WindowManager.playground) {
                    this.boxManager.setRoot(WindowManager.playground);
                }
                this.bindMainView(mainViewElement, params.disableCameraTransform);
                if (WindowManager.playground) {
                    this.cursorManager?.setupWrapper(WindowManager.playground);
                    this.playground$.setValue(WindowManager.playground);
                }
               
            }
        }
        emitter.emit("updateManagerRect");
        this.appManager?.refresh();
        this.appManager?.resetMaximized();
        this.appManager?.resetMinimized();
        this.appManager?.displayerWritableListener(!this.room.isWritable);
        WindowManager.container = container;
    }

    public bindCollectorContainer(container: HTMLElement) {
        if (WindowManager.isCreated && this.boxManager) {
            this.boxManager.setCollector(container);
        } else {
            if (WindowManager.params) {
                WindowManager.params.collectorContainer = container;
            }
        }
    }

    /**
     * 注册插件
     */
    public static register<AppOptions = any, SetupResult = any, Attributes extends Record<string, any> = any>(
        params: RegisterParams<AppOptions, SetupResult, Attributes>
    ): Promise<void> {
        return appRegister.register(params);
    }

    /**
     * 注销插件
     */
    public static unregister(kind: string) {
        return appRegister.unregister(kind);
    }

    /**
     * 创建一个 app 至白板
     */
    public async addApp<T = any>(params: AddAppParams<T>): Promise<string | undefined> {
        if (this.appManager) {
            // 移除根目录时需要做一些异步的释放操作 addApp 需要等待释放完成才可以继续添加
            if (this.appManager.rootDirRemoving) {
                return new Promise((resolve, reject) => {
                    emitter.once("rootDirRemoved").then(async () => {
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

    private async _addApp<T = any>(params: AddAppParams<T>): Promise<string | undefined> {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new Errors.ParamsInvalidError();
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
        if (!this.appManager) {
            return false;
        }
        if (index < 0 || index >= this.pageState.length) {
            console.warn(`[WindowManager]: index ${index} out of range`);
            return false;
        }
        await this.appManager.setMainViewSceneIndex(index);
        return true;
    }

    public async addPage(params?: AddPageParams): Promise<void> {
        if (this.appManager) {
            const after = params?.after;
            const scene = params?.scene || {};
            const scenes = Array.isArray(scene) ? scene : [scene];
            if (after) {
                const nextIndex = this.mainViewSceneIndex + 1;
                this.room.putScenes(ROOT_DIR, scenes, nextIndex);
            } else {
                this.room.putScenes(ROOT_DIR, scenes);
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
            return this.appManager.removeSceneByIndex(needRemoveIndex);;
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
        emitter.emit("setReadonly", readonly);
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
    public setViewMode(mode: ManagerViewMode): void {
        log("setViewMode", mode);
        if (this.viewMode$.value === 'scroll' && mode !== 'scroll') {
            throw new Errors.InvalidViewModeError();
        }
        const mainViewProxy = this.appManager?.mainViewProxy;
        if (mode === ViewMode.Broadcaster || mode === ViewMode.Follower) {
            if (this.canOperate && mode === ViewMode.Broadcaster) {
                mainViewProxy?.storeCurrentCamera();
                mainViewProxy?.storeCurrentSize();
            }
            mainViewProxy?.start();
        }
        if (mode === ViewMode.Freedom || mode === "scroll") {
            mainViewProxy?.stop();
        }
        this.viewMode$.setValue(mode);
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

    public get baseCamera() {
        if (this.appManager) {
            return this.appManager.mainViewProxy.camera$.value;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get baseSize() {
        if (this.appManager) {
            return this.appManager.mainViewProxy.size$.value;
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

    public get darkMode(): boolean {
        return Boolean(this.appManager?.boxManager?.darkMode);
    }

    public get viewMode() {
        return this.viewMode$.value;
    }

    public get prefersColorScheme(): TeleBoxColorScheme | undefined {
        if (this.appManager) {
            return this.appManager.boxManager?.prefersColorScheme;
        } else {
            throw new Errors.AppManagerNotInitError();
        }
    }

    public get fullscreen(): TeleBoxFullscreen | undefined {
        if (this.appManager) {
            return this.appManager.boxManager?.teleBoxManager.fullscreen;
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

    public get scrollState(): ScrollState | undefined {
        return this.appManager?.scrollMode?.scrollState$.value;
    }

    public get teleboxManager(): TeleBoxManager {
        if (!this.boxManager) {
            throw new Errors.BoxManagerNotInitializeError();
        }
        return this.boxManager.teleBoxManager;
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

    public moveCamera = (camera: MoveCameraParams): void => {
        const pureCamera = omit(camera, ["animationMode"]);
        const mainViewCamera = { ...this.mainView.camera };
        if (isEqual({ ...mainViewCamera, ...pureCamera }, mainViewCamera)) return;
        this.appManager?.mainViewProxy.moveCamera(camera);
        this.appManager?.dispatchInternalEvent(Events.MoveCamera, camera);
    }

    public moveCameraToContain(
        rectangle: Rectangle &
            Readonly<{
                animationMode?: AnimationMode;
            }>
    ): void {
        // this.debouncedStoreCamera();
        this.mainView.moveCameraToContain(rectangle);
        this.appManager?.dispatchInternalEvent(Events.MoveCameraToContain, rectangle);
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
        this.appManager?.destroy();
        this.cursorManager?.destroy();
        WindowManager.container = undefined;
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

    public setFullscreen(fullscreen: TeleBoxFullscreen): void {
        this.appManager?.boxManager?.teleBoxManager.setFullscreen(fullscreen);
    }

    public cleanCurrentScene(): void {
        this.focusedView?.cleanCurrentScene();
    }

    public redo(): number {
        return this.focusedView?.redo() || 0;
    }

    public undo(): number {
        return this.focusedView?.undo() || 0;
    }

    public delete(): void {
        this.focusedView?.delete();
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
    
    /** @inner */
    public _refresh() {
        this.appManager?.mainViewProxy.rebind();
        if (WindowManager.container) {
            this.bindContainer(WindowManager.container);
        }
        this.appManager?.refresher.refresh();
    }

    public setContainerSizeRatio(ratio: number) {
        if (!isNumber(ratio)) {
            throw new Error(`[WindowManager]: updateContainerSizeRatio error, ratio must be a number. but got ${ratio}`);
        }
        WindowManager.containerSizeRatio = ratio;
        this.containerSizeRatio = ratio;
        emitter.emit("containerSizeRatioUpdate", ratio);
    }

    public setContainerStyle(style: string) {
        this.boxManager?.teleBoxManager.setContainerStyle(style);
    }

    public setStageStyle(style: string) {
        this.boxManager?.teleBoxManager.setStageStyle(style);
    }

    public setBaseSize(size: Size) {
        this.appManager?.mainViewProxy.setMainViewSize(size);
        setTimeout(() => {
            if (!this.appManager || !this.appManager.mainViewProxy.camera$.value) return;
            this.appManager.mainViewProxy.storeCamera({
                ...this.appManager.mainViewProxy.camera$.value,
                id: this.appManager.uid,
                scale: 1
            });
        }, 500);
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

    public createPPTHandler() {
        return {
            onPageJumpTo: (_pptUUID: string, index: number) => {
                this.appManager?.focusApp?.appContext?.whiteBoardView?.jumpPage(index);
            },
            onPageToNext: () => {
                if (this.focused) {
                    this.appManager?.focusApp?.appContext?.whiteBoardView?.nextPage();
                }
            },
            onPageToPrev: () => {
                if (this.focused) {
                    this.appManager?.focusApp?.appContext?.whiteBoardView?.prevPage();
                }
            }
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
        }
    }
}

setupBuiltin();

export * from "./typings";

export { BuiltinApps, BuiltinAppsMap } from "./BuiltinApps";
export type { PublicEvent } from "./callback";
export type { Member } from "./Helper";
