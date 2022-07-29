import { AppAttributes, Events, MIN_HEIGHT, MIN_WIDTH } from "./constants";
import { debounce } from "lodash";
import { TELE_BOX_STATE, TeleBoxCollector, TeleBoxManager } from "@netless/telebox-insider";
import { WindowManager } from "./index";
import type { BoxEmitterType } from "./BoxEmitter";
import type { AddAppOptions, AppInitState } from "./index";
import type {
    TeleBoxManagerUpdateConfig,
    TeleBoxManagerCreateConfig,
    ReadonlyTeleBox,
    TeleBoxManagerConfig,
    TeleBoxColorScheme,
    TeleBoxRect,
    TeleBoxConfig,
} from "@netless/telebox-insider";
import type Emittery from "emittery";
import type { NetlessApp } from "./typings";
import type { View } from "white-web-sdk";
import type { CallbacksType } from "./callback";
import type { EmitterType } from "./InternalEmitter";

export { TELE_BOX_STATE };

export type CreateBoxParams = {
    appId: string;
    app: NetlessApp;
    view?: View;
    emitter?: Emittery;
    options?: AddAppOptions;
    canOperate?: boolean;
    smartPosition?: boolean;
};

type AppId = { appId: string };

type MoveBoxParams = AppId & { x: number; y: number };

type ResizeBoxParams = AppId & { width: number; height: number; skipUpdate: boolean };

type SetBoxMinSizeParams = AppId & { minWidth: number; minHeight: number };

type SetBoxTitleParams = AppId & { title: string };

export type CreateTeleBoxManagerConfig = {
    collectorContainer?: HTMLElement;
    collectorStyles?: Partial<CSSStyleDeclaration>;
    prefersColorScheme?: TeleBoxColorScheme;
};

export type BoxManagerContext = {
    safeSetAttributes: (attributes: any) => void;
    getMainView: () => View;
    updateAppState: (appId: string, field: AppAttributes, value: any) => void;
    emitter: EmitterType;
    boxEmitter: BoxEmitterType;
    callbacks: CallbacksType;
    canOperate: () => boolean;
    notifyContainerRectUpdate: (rect: TeleBoxRect) => void;
    cleanFocus: () => void;
    setAppFocus: (appId: string) => void;
};

export const createBoxManager = (
    manager: WindowManager,
    callbacks: CallbacksType,
    emitter: EmitterType,
    boxEmitter: BoxEmitterType,
    options: CreateTeleBoxManagerConfig
) => {
    return new BoxManager(
        {
            safeSetAttributes: (attributes: any) => manager.safeSetAttributes(attributes),
            getMainView: () => manager.mainView,
            updateAppState: (...args) => manager.appManager?.store.updateAppState(...args),
            canOperate: () => manager.canOperate,
            notifyContainerRectUpdate: (rect: TeleBoxRect) =>
                manager.appManager?.notifyContainerRectUpdate(rect),
            cleanFocus: () => manager.appManager?.store.cleanFocus(),
            setAppFocus: (appId: string) => manager.appManager?.store.setAppFocus(appId, true),
            callbacks,
            emitter,
            boxEmitter
        },
        options
    );
};

export class BoxManager {
    public teleBoxManager: TeleBoxManager;

    constructor(
        private context: BoxManagerContext,
        private createTeleBoxManagerConfig?: CreateTeleBoxManagerConfig
    ) {
        const { emitter, callbacks, boxEmitter } = context;
        this.teleBoxManager = this.setupBoxManager(createTeleBoxManagerConfig);

        // 使用 _xxx$.reaction 订阅修改的值, 不管有没有 skipUpdate, 修改值都会触发回调
        this.teleBoxManager._state$.reaction(state => {
            callbacks.emit("boxStateChange", state);
            emitter.emit("boxStateChange", state);
        });

        this.teleBoxManager._darkMode$.reaction(darkMode => {
            callbacks.emit("darkModeChange", darkMode);
        });
        this.teleBoxManager._prefersColorScheme$.reaction(colorScheme => {
            callbacks.emit("prefersColorSchemeChange", colorScheme);
        });

        // ppt 在最小化后刷新恢复正常大小，拿不到正确的宽高，需要手动触发一下窗口的 resize
        this.teleBoxManager._minimized$.reaction(minimized => {
            if (!minimized) {
                setTimeout(() => {
                    const offset = 0.001 * (Math.random() > 0.5 ? 1 : -1);
                    this.teleBoxManager.boxes.forEach(box => {
                        box.resize(box.intrinsicWidth + offset, box.intrinsicHeight + offset, true);
                    });
                }, 400);
            }
        });

        // events.on 的值则会根据 skipUpdate 来决定是否触发回调
        this.teleBoxManager.events.on("minimized", minimized => {
            this.context.safeSetAttributes({ minimized });
            if (minimized) {
                this.context.cleanFocus();
                this.blurAllBox();
            } else {
                const topBox = this.getTopBox();
                if (topBox) {
                    this.context.setAppFocus(topBox.id);
                    this.focusBox({ appId: topBox.id }, false);
                }
            }
        });
        this.teleBoxManager.events.on("maximized", maximized => {
            this.context.safeSetAttributes({ maximized });
        });
        this.teleBoxManager.events.on("removed", boxes => {
            boxes.forEach(box => {
                boxEmitter.emit("close", { appId: box.id });
            });
        });
        this.teleBoxManager.events.on(
            "intrinsic_move",
            debounce((box: ReadonlyTeleBox): void => {
                boxEmitter.emit("move", { appId: box.id, x: box.intrinsicX, y: box.intrinsicY });
            }, 50)
        );
        this.teleBoxManager.events.on(
            "intrinsic_resize",
            debounce((box: ReadonlyTeleBox): void => {
                boxEmitter.emit("resize", {
                    appId: box.id,
                    width: box.intrinsicWidth,
                    height: box.intrinsicHeight,
                });
            }, 200)
        );
        this.teleBoxManager.events.on("focused", box => {
            if (box) {
                if (this.canOperate) {
                    boxEmitter.emit("focus", { appId: box.id });
                } else {
                    this.teleBoxManager.blurBox(box.id);
                }
            }
        });
        this.teleBoxManager.events.on("z_index", box => {
            this.context.updateAppState(box.id, AppAttributes.ZIndex, box.zIndex);
        });
        emitter.on("playgroundSizeChange", () => this.updateManagerRect());
        emitter.on("updateManagerRect", () => this.updateManagerRect());
    }

    private get mainView() {
        return this.context.getMainView();
    }

    private get canOperate() {
        return this.context.canOperate();
    }

    public get boxState() {
        return this.teleBoxManager.state;
    }

    public get maximized() {
        return this.teleBoxManager.maximized;
    }

    public get minimized() {
        return this.teleBoxManager.minimized;
    }

    public get darkMode() {
        return this.teleBoxManager.darkMode;
    }

    public get prefersColorScheme(): TeleBoxColorScheme {
        return this.teleBoxManager.prefersColorScheme;
    }

    public get boxSize() {
        return this.teleBoxManager.boxes.length;
    }

    public createBox(params: CreateBoxParams): void {
        if (!this.teleBoxManager) return;
        let { minwidth = MIN_WIDTH, minheight = MIN_HEIGHT } = params.app.config ?? {};
        const { width, height } = params.app.config ?? {};
        const title = params.options?.title || params.appId;
        const rect = this.teleBoxManager.containerRect;

        if (minwidth > 1) {
            minwidth = minwidth / rect.width;
        }

        if (minheight > 1) {
            minheight = minheight / rect.height;
        }

        const createBoxConfig: TeleBoxManagerCreateConfig = {
            title,
            minWidth: minwidth,
            minHeight: minheight,
            width,
            height,
            id: params.appId,
        };
        this.teleBoxManager.create(createBoxConfig, params.smartPosition);
        this.context.emitter.emit(`${params.appId}${Events.WindowCreated}` as any);
    }

    public setBoxInitState(appId: string): void {
        const box = this.teleBoxManager.queryOne({ id: appId });
        if (box) {
            if (box.state === TELE_BOX_STATE.Maximized) {
                this.context.boxEmitter.emit("resize", {
                    appId: appId,
                    x: box.x,
                    y: box.y,
                    width: box.intrinsicWidth,
                    height: box.intrinsicHeight,
                });
            }
        }
    }

    public setupBoxManager(
        createTeleBoxManagerConfig?: CreateTeleBoxManagerConfig
    ): TeleBoxManager {
        const root = WindowManager.wrapper ? WindowManager.wrapper : document.body;
        const rect = root.getBoundingClientRect();
        const initManagerState: TeleBoxManagerConfig = {
            root: root,
            containerRect: {
                x: 0,
                y: 0,
                width: rect.width,
                height: rect.height,
            },
            fence: false,
            prefersColorScheme: createTeleBoxManagerConfig?.prefersColorScheme,
        };

        const manager = new TeleBoxManager(initManagerState);
        if (this.teleBoxManager) {
            this.teleBoxManager.destroy();
        }
        this.teleBoxManager = manager;
        const container = createTeleBoxManagerConfig?.collectorContainer || WindowManager.wrapper;
        if (container) {
            this.setCollectorContainer(container);
        }
        return manager;
    }

    public setCollectorContainer(container: HTMLElement) {
        const collector = new TeleBoxCollector({
            styles: this.createTeleBoxManagerConfig?.collectorStyles,
        }).mount(container);
        this.teleBoxManager.setCollector(collector);
    }

    public getBox(appId: string): ReadonlyTeleBox | undefined {
        return this.teleBoxManager.queryOne({ id: appId });
    }

    public closeBox(appId: string, skipUpdate = false): ReadonlyTeleBox | undefined {
        return this.teleBoxManager.remove(appId, skipUpdate);
    }

    public boxIsFocus(appId: string): boolean | undefined {
        const box = this.getBox(appId);
        return box?.focus;
    }

    public getFocusBox(): ReadonlyTeleBox | undefined {
        const boxes = this.teleBoxManager.query({ focus: true });
        return boxes[0];
    }

    public getTopBox(): ReadonlyTeleBox | undefined {
        return this.teleBoxManager.topBox;
    }

    public updateBoxState(state?: AppInitState): void {
        if (!state) return;
        const box = this.getBox(state.id);
        if (box) {
            this.teleBoxManager.update(
                box.id,
                {
                    x: state.x,
                    y: state.y,
                    width: state.width || 0.5,
                    height: state.height || 0.5,
                    zIndex: state.zIndex,
                },
                true
            );
            setTimeout(() => {
                if (state.focus) {
                    this.teleBoxManager.focusBox(box.id, true);
                }
                if (state.maximized != null) {
                    this.teleBoxManager.setMaximized(Boolean(state.maximized), true);
                }
                if (state.minimized != null) {
                    this.teleBoxManager.setMinimized(Boolean(state.minimized), true);
                }
            }, 50);
            this.context.callbacks.emit("boxStateChange", this.teleBoxManager.state);
        }
    }

    public updateManagerRect(): void {
        const rect = this.mainView.divElement?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            const containerRect = { x: 0, y: 0, width: rect.width, height: rect.height };
            this.teleBoxManager.setContainerRect(containerRect);
            this.context.notifyContainerRectUpdate(this.teleBoxManager.containerRect);
        }
    }

    public moveBox({ appId, x, y }: MoveBoxParams): void {
        this.teleBoxManager.update(appId, { x, y }, true);
    }

    public focusBox({ appId }: AppId, skipUpdate = true): void {
        this.teleBoxManager.focusBox(appId, skipUpdate);
    }

    public resizeBox({ appId, width, height, skipUpdate }: ResizeBoxParams): void {
        this.teleBoxManager.update(appId, { width, height }, skipUpdate);
    }

    public setBoxMinSize(params: SetBoxMinSizeParams): void {
        this.teleBoxManager.update(
            params.appId,
            {
                minWidth: params.minWidth,
                minHeight: params.minHeight,
            },
            true
        );
    }

    public setBoxTitle(params: SetBoxTitleParams): void {
        this.teleBoxManager.update(params.appId, { title: params.title }, true);
    }

    public blurAllBox(): void {
        this.teleBoxManager.blurAll();
    }

    public updateAll(config: TeleBoxManagerUpdateConfig): void {
        this.teleBoxManager.updateAll(config);
    }

    public setMaximized(maximized: boolean, skipUpdate = true): void {
        if (maximized !== this.maximized) {
            this.teleBoxManager.setMaximized(maximized, skipUpdate);
        }
    }

    public setMinimized(minimized: boolean, skipUpdate = true) {
        this.teleBoxManager.setMinimized(minimized, skipUpdate);
    }

    public focusTopBox(): void {
        const boxes = this.teleBoxManager.query();
        if (boxes.length >= 1) {
            const box = this.getTopBox();
            if (box) {
                this.focusBox({ appId: box.id }, false);
            }
        }
    }

    public updateBox(id: string, payload: TeleBoxConfig, skipUpdate = true): void {
        this.teleBoxManager.update(id, payload, skipUpdate);
    }

    public setReadonly(readonly: boolean) {
        this.teleBoxManager.setReadonly(readonly);
    }

    public setPrefersColorScheme(colorScheme: TeleBoxColorScheme) {
        this.teleBoxManager.setPrefersColorScheme(colorScheme);
    }

    public setZIndex(id: string, zIndex: number, skipUpdate = true) {
        this.teleBoxManager.update(id, { zIndex }, skipUpdate);
    }

    public destroy() {
        this.teleBoxManager.destroy();
    }
}
