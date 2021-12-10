import Emittery from "emittery";
import pRetry from "p-retry";
import { AppManager } from "./AppManager";
import { AppManagerNotInitError, InvalidScenePath } from "./Utils/error";
import { appRegister } from "./Register";
import { ContainerResizeObserver } from "./ContainerResizeObserver";
import { Creator } from "./App";
import { CursorManager } from "./Cursor";
import { DEFAULT_CONTAINER_RATIO, VERSION } from "./constants";
import { Fields } from "./AttributesDelegate";
import { initDb } from "./Register/storage";
import { injectStyle } from "./Utils/Style";
import { InvisiblePlugin, isPlayer, isRoom, RoomPhase, ScenePathType, ViewMode } from "white-web-sdk";
import { isNull, isObject } from "lodash";
import { log } from "./Utils/log";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { setupBuiltin } from "./BuiltinApp";
import {
    addEmitterOnceListener,
    ensureValidScenePath,
    isValidScenePath,
    wait,
    setupWrapper,
    checkIsDynamicPPT,
    checkVersion,
} from "./Utils/Common";
import type { TELE_BOX_STATE } from "./BoxManager";
import type { Apps } from "./AttributesDelegate";
import type {
    Displayer,
    SceneDefinition,
    View,
    Room,
    InvisiblePluginContext,
    Camera,
    AnimationMode,
    CameraBound,
    Rectangle,
    MemberState,
    RoomMember,
    RoomState,
    Player,
} from "white-web-sdk";
import type { AppListeners } from "./AppListener";
import type { NetlessApp, Point, RegisterParams } from "./typings";
import type { TeleBoxState } from "@netless/telebox-insider";
import type { AppProxy } from "./App";
import style from "./style.css?inline";

injectStyle(style);

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
    roomMembersChange: readonly RoomMember[];
    roomStateChange: Partial<RoomState>;
    updateManagerRect: void;
};

export const emitter: Emittery<EmitterEvent> = new Emittery();

export type PublicEvent = {
    boxStateChange: `${TELE_BOX_STATE}`;
};

export type MountParams = {
    room: Room | Player;
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

    public version = VERSION;

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    public appManager?: AppManager;
    public cursorManager?: CursorManager;
    public viewMode = ViewMode.Broadcaster;
    public isReplay = isPlayer(this.displayer);

    private containerResizeObserver?: ContainerResizeObserver;

    constructor(context: InvisiblePluginContext) {
        super(context);
    }

    /**
     * 挂载 WindowManager
     */
    public static async mount(params: MountParams): Promise<WindowManager> {
        let chessboard = true;
        let disableCameraTransform = false;

        const room = params.room;
        const container = params.container;
        const collectorContainer = params.collectorContainer;
        const containerSizeRatio = params.containerSizeRatio;
        const collectorStyles = params.collectorStyles;
        const debug = params.debug;
        if (params.chessboard != null) {
            chessboard = params.chessboard;
        }
        const overwriteStyles = params.overwriteStyles;
        const cursor = params.cursor;
        disableCameraTransform = Boolean(params?.disableCameraTransform);

        checkVersion();

        if (!container) {
            throw new Error("[WindowManager]: Container must provide");
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }

        let manager = await this.initManager(room);
        this.debug = Boolean(debug);
        setupBuiltin();
        log("Already insert room", manager);

        if (isRoom(this.displayer)) {
            if (!manager) {
                throw new Error("[WindowManager]: init InvisiblePlugin failed");
            }
            if (room.phase !== RoomPhase.Connected) {
                throw new Error("[WindowManager]: Room only Connected can be mount");
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
        });

        if (cursor) {
            manager.cursorManager = new CursorManager(manager.appManager);
        }

        manager.containerResizeObserver = ContainerResizeObserver.create(
            playground,
            sizer,
            wrapper,
            manager.cursorManager
        );

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

    private static async initManager(room: Room | Player): Promise<WindowManager> {
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        if (!manager) {
            if (isRoom(room)) {
                room = room as Room;
                if (room.isWritable === false) {
                    try {
                        await room.setWritable(true);
                    } catch (error) {
                        throw new Error("[WindowManger]: room must be switched to be writable");
                    }
                    manager = (await room.createInvisiblePlugin(
                        WindowManager,
                        {}
                    )) as unknown as WindowManager;
                    manager.ensureAttributes();
                    await wait(500);
                    await room.setWritable(false);
                } else {
                    manager = (await room.createInvisiblePlugin(
                        WindowManager,
                        {}
                    )) as unknown as WindowManager;
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
            const isDynamicPPT = this.setupScenePath(params, this.appManager);
            if (isDynamicPPT === undefined) {
                return;
            }
            if (params?.options?.scenePath) {
                params.options.scenePath = ensureValidScenePath(params.options.scenePath);
            }
            const appId = await Creator.create({ ...params, isAddApp: true, isDynamicPPT });
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
                if (checkIsDynamicPPT(scenes)) {
                    isDynamicPPT = true;
                    if (this.displayer.scenePathType(scenePath) === ScenePathType.None) {
                        this.room?.putScenes(scenePath, scenes);
                    }
                } else {
                    if (this.displayer.scenePathType(scenePath) === ScenePathType.None) {
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

    public setMemberState(state: Partial<MemberState>): MemberState {
        return (this.mainView as any).setMemberState(state);
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
                this.safeSetAttributes({ _mainScenePath: sceneState.contextPath });
            }
            if (!this.attributes["_mainSceneIndex"]) {
                this.safeSetAttributes({ _mainSceneIndex: sceneState.index });
            }
        }
    }
}

export * from "./typings";

export { BuiltinApps } from "./BuiltinApp";
