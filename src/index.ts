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
import { log } from "./Utils/log";
import { PageStateImpl } from "./PageState";
import { ReconnectRefresher } from "./ReconnectRefresher";
import { replaceRoomFunction } from "./Utils/RoomHacker";
import { setupBuiltin } from "./BuiltinApps";
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
import type Emittery from "emittery";
import type { PageController, AddPageParams, PageState } from "./Page";
import { boxEmitter } from "./BoxEmitter";
import { IframeBridge } from "./View/IframeBridge";
import { setOptions } from "@netless/app-media-player";
import type { ExtendPluginInstance } from "./ExtendPluginManager";
import { ExtendPluginManager } from "./ExtendPluginManager";
import { getExtendClass } from "./Utils/extendClass";
import type { ExtendClass } from "./Utils/extendClass";

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
};

type DiagnosticColorChannels = {
    raw: string;
    r?: number;
    g?: number;
    b?: number;
    a?: number;
};

type DiagnosticRect = {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
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
    private static _resolve = (_manager: WindowManager) => void 0;

    public version = __APP_VERSION__;
    public dependencies = __APP_DEPENDENCIES__;

    public appListeners?: AppListeners;

    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;
    public appManager?: AppManager;
    public cursorManager?: CursorManager;
    public viewMode = ViewMode.Broadcaster;
    public isReplay = isPlayer(this.displayer);
    private _pageState?: PageStateImpl;
    private _fullscreen?: boolean;
    private _cursorUIDs: string[] = [];
    private _cursorUIDsStyleDOM?: HTMLStyleElement;

    public _appliancePlugin?: any;

    private boxManager?: BoxManager;
    private static params?: MountParams;
    static extendClass?: ExtendClass;

    private containerResizeObserver?: ContainerResizeObserver;
    public containerSizeRatio = WindowManager.containerSizeRatio;

    private extendPluginManager?: ExtendPluginManager;

    private _roomLogger?: Logger;

    get Logger(): Logger | undefined {
        return this._roomLogger;
    }

    constructor(context: InvisiblePluginContext) {
        super(context);
        WindowManager.displayer = context.displayer;
        (window as any).NETLESS_DEPS = __APP_DEPENDENCIES__;
        this.emitter.on('mainViewScenePathChange', this.onMainViewScenePathChangeHandler)
    }

    public static onCreate(manager: WindowManager) {
        WindowManager._resolve(manager);
    }

    public static async mount(
        params: MountParams,
        extendClass?: ExtendClass
    ): Promise<WindowManager> {
        const room = params.room;
        WindowManager.container = params.container;
        WindowManager.supportAppliancePlugin = params.supportAppliancePlugin;
        const containerSizeRatio = params.containerSizeRatio;
        const debug = params.debug;

        const cursor = params.cursor;
        WindowManager.params = params;
        WindowManager.extendClass = extendClass;
        WindowManager.displayer = params.room;
        checkVersion();
        let manager: WindowManager | undefined = undefined;
        if (isRoom(room)) {
            if (room.phase !== RoomPhase.Connected) {
                throw new Error("[WindowManager]: Room only Connected can be mount");
            }
            if (room.phase === RoomPhase.Connected && room.isWritable) {
                // redo undo 需要设置这个属性
                room.disableSerialization = false;
            }
            manager = await this.initManager(room);
            if (manager) {
                manager._roomLogger = (room as unknown as { logger: Logger }).logger;
                if (WindowManager.registered.size > 0) {
                    manager._roomLogger.info(
                        `[WindowManager] registered apps: ${JSON.stringify(
                            Array.from(WindowManager.registered.keys())
                        )}`
                    );
                }
            }
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }

        this.debug = Boolean(debug);
        if (this.debug) {
            setOptions({ verbose: true });
        }
        if (manager?._roomLogger) {
            manager._roomLogger.info(
                `[WindowManager] Already insert room version: ${manager.version}`
            );
        } else {
            log("Already insert room", manager);
        }

        if (isRoom(this.displayer)) {
            if (!manager) {
                throw new Error("[WindowManager]: init InvisiblePlugin failed");
            }
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

        if (containerSizeRatio) {
            WindowManager.containerSizeRatio = containerSizeRatio;
        }
        await manager.ensureAttributes();

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

        manager.extendPluginManager = new ExtendPluginManager({
            internalEmitter: internalEmitter,
            windowManager: manager,
        });

        if (containerSizeRatio) {
            manager.containerSizeRatio = containerSizeRatio;
        }

        if (params.container) {
            manager.bindContainer(params.container);
        }

        replaceRoomFunction(room, manager);
        internalEmitter.emit("onCreated");
        WindowManager.isCreated = true;
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
        try {
            await initDb();
        } catch (error) {
            manager._roomLogger?.warn(`[WindowManager] indexedDB open failed: ${error.message}`);
            console.warn("[WindowManager]: indexedDB open failed");
            console.log(error);
        }
        manager.emitter.on('mainViewScenePathChange', manager.onMainViewScenePathChangeHandler)
        return manager;
    }

    public onMainViewScenePathChangeHandler = (scenePath: string) => {
        const mainViewElement = this.mainView.divElement;
        this.logMainViewVisibilityDiagnostics("onMainViewScenePathChange", scenePath, mainViewElement);
        if (mainViewElement) {
            const backgroundImage = mainViewElement.querySelector('.background img');
            if (backgroundImage) {
                const backgroundImageRect = backgroundImage?.getBoundingClientRect();
                const backgroundImageCSS = window.getComputedStyle(backgroundImage);
                const backgroundImageVisible = backgroundImageRect?.width > 0 && backgroundImageRect?.height > 0 && backgroundImageCSS.display !== 'none';
                const camera = this.mainView.camera;
                console.log("[window-manager] backgroundImageVisible:" + backgroundImageVisible + " camera:" + JSON.stringify(camera));
                return;
            }
            console.log("[window-manager] onMainViewScenePathChange scenePath:" + scenePath + ' backgroundImageVisible is not found');
            return;
        }
        console.log("[window-manager] onMainViewScenePathChange scenePath:" + scenePath + ' mainViewElement is not found');
    }

    public logMainViewVisibilityDiagnostics(
        tag: string,
        scenePath?: string,
        mainViewElement?: HTMLDivElement | null
    ): void {
        const element = mainViewElement ?? this.mainView?.divElement;
        const label = scenePath ? `${tag}:${scenePath}` : tag;
        const payload = this.collectMainViewVisibilityDiagnostics(element, scenePath);
        this.emitMainViewVisibilityDiagnostic(label, payload.summary);
        if (payload.details) {
            this.emitMainViewVisibilityDiagnostic(`${label}:details`, payload.details);
        }
    }

    private emitMainViewVisibilityDiagnostic(tag: string, payload: unknown): void {
        const content = `[window-manager][visibility][${tag}] ${JSON.stringify(payload)}`;
        // console.log(content);
        this._roomLogger?.info(content);
    }

    private collectMainViewVisibilityDiagnostics(
        mainViewElement: HTMLDivElement | null | undefined,
        scenePath?: string
    ): {
        summary: Record<string, any>;
        details: Record<string, any> | null;
    } {
        const element = mainViewElement ?? null;
        const backgroundImage = element?.querySelector(".background img") as HTMLImageElement | null;
        const elementDiagnostic = element ? this.collectElementDiagnostic(element) : null;
        const chainDiagnostics = element ? this.collectElementChainDiagnostics(element) : [];
        const elementRect = element?.getBoundingClientRect?.() ?? null;
        const centerPoint = elementRect
            ? {
                  x: elementRect.left + elementRect.width / 2,
                  y: elementRect.top + elementRect.height / 2,
              }
            : undefined;
        const topElement =
            centerPoint &&
            Number.isFinite(centerPoint.x) &&
            Number.isFinite(centerPoint.y)
                ? document.elementFromPoint(centerPoint.x, centerPoint.y)
                : null;
        const overlayStack =
            centerPoint &&
            Number.isFinite(centerPoint.x) &&
            Number.isFinite(centerPoint.y) &&
            document.elementsFromPoint
                ? document
                      .elementsFromPoint(centerPoint.x, centerPoint.y)
                      .slice(0, 10)
                      .map(item => this.describeElement(item))
                      .filter((item): item is string => item !== null)
                : [];
        const topElementDiagnostic = topElement ? this.collectElementDiagnostic(topElement) : null;
        const backgroundImageDiagnostic = backgroundImage
            ? this.collectImageDiagnostic(backgroundImage)
            : null;
        const blockers: string[] = [];
        const warnings: string[] = [];
        const suspiciousAncestors: Array<Record<string, any>> = [];
        const mainViewBlockers: string[] = [];
        const mainViewWarnings: string[] = [];

        if (!element) {
            blockers.push("mainViewElement.missing");
        }

        if (document.hidden || document.visibilityState === "hidden") {
            blockers.push("document.hidden");
        }

        if (elementDiagnostic) {
            this.appendRenderImpactIssues(
                "mainViewElement",
                elementDiagnostic,
                mainViewBlockers,
                mainViewWarnings
            );
            blockers.push(...mainViewBlockers);
            warnings.push(...mainViewWarnings);
        }

        chainDiagnostics.slice(1).forEach((diagnostic, index) => {
            const ancestorBlockers: string[] = [];
            const ancestorWarnings: string[] = [];
            this.appendRenderImpactIssues(
                `ancestor[${index + 1}]`,
                diagnostic,
                ancestorBlockers,
                ancestorWarnings
            );
            if (ancestorBlockers.length > 0 || ancestorWarnings.length > 0) {
                blockers.push(...ancestorBlockers);
                warnings.push(...ancestorWarnings);
                suspiciousAncestors.push(this.pickRenderRelevantFields(diagnostic));
            }
        });

        let backgroundImageStatus: Record<string, any> | null = null;
        const backgroundImageBlockers: string[] = [];
        const backgroundImageWarnings: string[] = [];
        if (backgroundImageDiagnostic) {
            backgroundImageStatus = this.pickBackgroundImageStatus(backgroundImageDiagnostic);
            this.appendRenderImpactIssues(
                "backgroundImage",
                backgroundImageDiagnostic,
                backgroundImageBlockers,
                backgroundImageWarnings
            );
            blockers.push(...backgroundImageBlockers);
            warnings.push(...backgroundImageWarnings);
            if (backgroundImageDiagnostic.complete === false) {
                warnings.push("backgroundImage.loading");
            } else if (backgroundImageDiagnostic.naturalWidth === 0) {
                warnings.push("backgroundImage.empty");
            }
        }

        let topElementSummary: Record<string, any> | null = null;
        if (topElementDiagnostic) {
            const coveredByOutsideElement = Boolean(
                element && topElement && topElement !== element && !element.contains(topElement)
            );
            topElementSummary = {
                node: topElementDiagnostic.node,
                coveredByOutsideElement,
            };
            if (coveredByOutsideElement) {
                warnings.push(`center.coveredBy:${topElementDiagnostic.node}`);
            }
        }

        const summary: Record<string, any> = {
            scenePath: scenePath || null,
            timestamp: new Date().toISOString(),
            status:
                blockers.length > 0
                    ? "blocked"
                    : warnings.length > 0
                      ? "uncertain"
                      : "likely-renderable",
            canRender: blockers.length === 0,
            blockers,
            warnings,
        };
        if (
            backgroundImageStatus &&
            backgroundImageDiagnostic &&
            (backgroundImageDiagnostic.complete === false ||
                backgroundImageDiagnostic.naturalWidth === 0)
        ) {
            summary.backgroundImage = backgroundImageStatus;
        }
        if (topElementSummary?.coveredByOutsideElement) {
            summary.coveringElement = topElementSummary.node;
        }

        const shouldEmitDetails =
            blockers.length > 0 ||
            warnings.some(
                warning =>
                    warning !== "backgroundImage.loading" &&
                    warning !== "backgroundImage.empty"
            );
        const details: Record<string, any> = {};
        if ((mainViewBlockers.length > 0 || mainViewWarnings.length > 0) && elementDiagnostic) {
            details.mainViewElement = this.pickRenderRelevantFields(elementDiagnostic);
        }
        if (
            suspiciousAncestors.length > 0
        ) {
            details.suspiciousAncestors = suspiciousAncestors;
        }
        if (
            backgroundImageDiagnostic &&
            (backgroundImageBlockers.length > 0 ||
                backgroundImageWarnings.length > 0 ||
                backgroundImageDiagnostic.complete === false ||
                backgroundImageDiagnostic.naturalWidth === 0)
        ) {
            details.backgroundImage = {
                ...this.pickRenderRelevantFields(backgroundImageDiagnostic),
                loadState: backgroundImageStatus,
            };
        }
        if (topElementSummary?.coveredByOutsideElement && topElementDiagnostic) {
            details.topElementAtCenter = {
                ...this.pickRenderRelevantFields(topElementDiagnostic),
                overlayStack,
            };
        }

        return {
            summary,
            details: shouldEmitDetails && Object.keys(details).length > 0 ? details : null,
        };
    }

    private collectElementChainDiagnostics(element: Element): Array<Record<string, any>> {
        const chain: Array<Record<string, any>> = [];
        let current: Element | null = element;
        while (current) {
            const diagnostic = this.collectElementDiagnostic(current);
            if (diagnostic) {
                chain.push(diagnostic);
            }
            current = current.parentElement;
        }
        return chain;
    }

    private collectImageDiagnostic(image: HTMLImageElement): Record<string, any> {
        const diagnostic = this.collectElementDiagnostic(image);
        return {
            ...diagnostic,
            currentSrc: image.currentSrc,
            src: image.getAttribute("src"),
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
        };
    }

    private appendRenderImpactIssues(
        label: string,
        diagnostic: Record<string, any>,
        blockers: string[],
        warnings: string[]
    ): void {
        const opacity = Number.parseFloat(diagnostic.opacity || "1");
        if (diagnostic.hiddenAttribute) {
            blockers.push(`${label}.hiddenAttribute`);
        }
        if (diagnostic.display === "none") {
            blockers.push(`${label}.display:none`);
        }
        if (diagnostic.visibility === "hidden" || diagnostic.visibility === "collapse") {
            blockers.push(`${label}.visibility:${diagnostic.visibility}`);
        }
        if (Number.isFinite(opacity) && opacity <= 0.01) {
            blockers.push(`${label}.opacity:${diagnostic.opacity}`);
        }
        if (diagnostic.contentVisibility === "hidden") {
            blockers.push(`${label}.contentVisibility:hidden`);
        }
        if (diagnostic.transform !== "none") {
            warnings.push(`${label}.transform`);
        }
        if (diagnostic.filter !== "none") {
            warnings.push(`${label}.filter`);
        }
        if (diagnostic.backdropFilter !== "none") {
            warnings.push(`${label}.backdropFilter`);
        }
        if (diagnostic.clipPath !== "none") {
            warnings.push(`${label}.clipPath`);
        }
        if (diagnostic.maskImage !== "none") {
            warnings.push(`${label}.maskImage`);
        }
        if (diagnostic.mixBlendMode !== "normal") {
            warnings.push(`${label}.mixBlendMode:${diagnostic.mixBlendMode}`);
        }
    }

    private pickRenderRelevantFields(diagnostic: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {
            node: diagnostic.node,
            display: diagnostic.display,
            visibility: diagnostic.visibility,
            opacity: diagnostic.opacity,
            hiddenAttribute: diagnostic.hiddenAttribute,
            contentVisibility: diagnostic.contentVisibility,
            backgroundColor: diagnostic.backgroundColor,
            backgroundAlpha: diagnostic.backgroundColorChannels?.a ?? null,
            color: diagnostic.color,
            colorAlpha: diagnostic.colorChannels?.a ?? null,
            textFillColor: diagnostic.textFillColor,
            textFillAlpha: diagnostic.textFillColorChannels?.a ?? null,
        };
        if (diagnostic.transform !== "none") {
            result.transform = diagnostic.transform;
        }
        if (diagnostic.filter !== "none") {
            result.filter = diagnostic.filter;
        }
        if (diagnostic.backdropFilter !== "none") {
            result.backdropFilter = diagnostic.backdropFilter;
        }
        if (diagnostic.mixBlendMode !== "normal") {
            result.mixBlendMode = diagnostic.mixBlendMode;
        }
        if (diagnostic.clipPath !== "none") {
            result.clipPath = diagnostic.clipPath;
        }
        if (diagnostic.maskImage !== "none") {
            result.maskImage = diagnostic.maskImage;
        }
        if (diagnostic.overflow !== "visible") {
            result.overflow = diagnostic.overflow;
        }
        if (diagnostic.zIndex !== "auto") {
            result.zIndex = diagnostic.zIndex;
        }
        return result;
    }

    private pickBackgroundImageStatus(diagnostic: Record<string, any>): Record<string, any> {
        return {
            found: true,
            complete: diagnostic.complete,
            currentSrc: diagnostic.currentSrc || diagnostic.src || "",
            naturalWidth: diagnostic.naturalWidth,
            naturalHeight: diagnostic.naturalHeight,
        };
    }

    private collectElementDiagnostic(element: Element | null): Record<string, any> | null {
        if (!element) {
            return null;
        }
        const style = window.getComputedStyle(element);
        const htmlElement = element as HTMLElement;
        return {
            node: this.describeElement(element),
            isConnected: element.isConnected,
            hiddenAttribute: htmlElement.hidden,
            ariaHidden: htmlElement.getAttribute("aria-hidden"),
            opacity: style.opacity,
            alpha: style.opacity,
            display: style.display,
            visibility: style.visibility,
            backgroundColor: style.backgroundColor,
            backgroundColorChannels: this.parseColorChannels(style.backgroundColor),
            color: style.color,
            colorChannels: this.parseColorChannels(style.color),
            textFillColor: style.getPropertyValue("-webkit-text-fill-color"),
            textFillColorChannels: this.parseColorChannels(
                style.getPropertyValue("-webkit-text-fill-color")
            ),
            filter: style.filter,
            backdropFilter: style.getPropertyValue("backdrop-filter"),
            mixBlendMode: style.mixBlendMode,
            transform: style.transform,
            contentVisibility: style.getPropertyValue("content-visibility"),
            clipPath: style.clipPath,
            maskImage:
                style.getPropertyValue("mask-image") ||
                style.getPropertyValue("-webkit-mask-image"),
            overflow: style.overflow,
            zIndex: style.zIndex,
        };
    }

    private describeElement(element: Element | null): string | null {
        if (!element) {
            return null;
        }
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : "";
        const className =
            typeof (element as HTMLElement).className === "string" &&
            (element as HTMLElement).className.trim()
                ? `.${(element as HTMLElement).className.trim().replace(/\s+/g, ".")}`
                : "";
        return `${tagName}${id}${className}`;
    }

    private serializeRect(rect?: DOMRect | null): DiagnosticRect | null {
        if (!rect) {
            return null;
        }
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
        };
    }

    private parseColorChannels(value?: string | null): DiagnosticColorChannels {
        const raw = value?.trim() || "";
        if (!raw) {
            return { raw };
        }
        if (raw === "transparent") {
            return { raw, r: 0, g: 0, b: 0, a: 0 };
        }
        const matches = raw.match(/^rgba?\((.+)\)$/i);
        if (!matches) {
            return { raw };
        }
        const parts = matches[1].split(",").map(part => part.trim());
        const [r, g, b, a] = parts.map(part => Number(part));
        return {
            raw,
            r: Number.isFinite(r) ? r : undefined,
            g: Number.isFinite(g) ? g : undefined,
            b: Number.isFinite(b) ? b : undefined,
            a: Number.isFinite(a) ? a : raw.startsWith("rgb(") ? 1 : undefined,
        };
    }

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
            internalEmitter
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
                this.logMainViewVisibilityDiagnostics("bindContainer.afterBindMainView");
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
            if (this.canOperate && mode === ViewMode.Broadcaster) {
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
        this.mainView.moveCameraToContain(rectangle);
        setTimeout(() => {
            this.appManager?.mainViewProxy.setCameraAndSize();
        }, 500);
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
        this.extendPluginManager?.destroy();
        WindowManager.container = undefined;
        WindowManager.wrapper = undefined;
        WindowManager.sizer = undefined;
        WindowManager.isCreated = false;
        if (WindowManager.playground) {
            WindowManager.playground.parentNode?.removeChild(WindowManager.playground);
        }
        WindowManager.params = undefined;
        this.emitter.off('mainViewScenePathChange', this.onMainViewScenePathChangeHandler);
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

    public cleanCurrentScene(): void {
        log("clean current scene");
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

    /** @internal */
    public _refresh() {
        this.appManager?.mainViewProxy.rebind();
        if (WindowManager.container) {
            this.bindContainer(WindowManager.container);
        }
        this.appManager?.refresher.refresh();
    }

    public setContainerSizeRatio(ratio: number) {
        if (!isNumber(ratio) || !(ratio > 0)) {
            throw new Error(
                `[WindowManager]: updateContainerSizeRatio error, ratio must be a positive number. but got ${ratio}`
            );
        }
        WindowManager.containerSizeRatio = ratio;
        this.containerSizeRatio = ratio;
        internalEmitter.emit("containerSizeRatioUpdate", ratio);
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
export type { PublicEvent } from "./callback";

export * from "./ExtendPluginManager";
