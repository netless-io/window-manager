import { callbacks, emitter, WindowManager } from "./index";
import { debounce, maxBy } from "lodash";
import { DEFAULT_COLLECTOR_STYLE, Events, MIN_HEIGHT, MIN_WIDTH } from "./constants";
import {
    TELE_BOX_MANAGER_EVENT,
    TELE_BOX_STATE,
    TeleBoxCollector,
    TeleBoxManager,
} from "@netless/telebox-insider";
import type { AddAppOptions, AppInitState } from "./index";
import type {
    TeleBoxManagerUpdateConfig,
    TeleBoxManagerCreateConfig,
    ReadonlyTeleBox,
    TeleBoxManagerConfig,
    TeleBoxColorScheme,
} from "@netless/telebox-insider";
import type Emittery from "emittery";
import type { AppManager } from "./AppManager";
import type { NetlessApp } from "./typings";
import type { View } from "white-web-sdk";

export { TELE_BOX_STATE };

export type CreateBoxParams = {
    appId: string;
    app: NetlessApp;
    view?: View;
    emitter?: Emittery;
    options?: AddAppOptions;
    canOperate?: boolean;
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

export class BoxManager {
    public teleBoxManager: TeleBoxManager;
    public appBoxMap: Map<string, string> = new Map();
    private mainView = this.manager.mainView;

    constructor(
        private manager: AppManager,
        createTeleBoxManagerConfig?: CreateTeleBoxManagerConfig
    ) {
        this.teleBoxManager = this.setupBoxManager(createTeleBoxManagerConfig);
        this.teleBoxManager.events.on(TELE_BOX_MANAGER_EVENT.State, state => {
            if (state) {
                callbacks.emit("boxStateChange", state);
                emitter.emit("boxStateChange", state);
            }
        });
        this.teleBoxManager.events.on("minimized", minimized => {
            this.manager.safeSetAttributes({ minimized });
        });
        this.teleBoxManager.events.on("maximized", maximized => {
            this.manager.safeSetAttributes({ maximized });
        });
        this.teleBoxManager.events.on("removed", boxes => {
            boxes.forEach(box => {
                emitter.emit("close", { appId: box.id });
            });
        });
        this.teleBoxManager.events.on(
            "intrinsic_move",
            debounce((box: ReadonlyTeleBox): void => {
                emitter.emit("move", { appId: box.id, x: box.intrinsicX, y: box.intrinsicY });
            }, 50)
        );
        this.teleBoxManager.events.on(
            "intrinsic_resize",
            debounce((box: ReadonlyTeleBox): void => {
                emitter.emit("resize", {
                    appId: box.id,
                    width: box.intrinsicWidth,
                    height: box.intrinsicHeight,
                });
            }, 200)
        );
        this.teleBoxManager.events.on("focused", box => {
            if (box) {
                if (this.manager.canOperate) {
                    emitter.emit("focus", { appId: box.id });
                } else {
                    this.teleBoxManager.update(box.id, { focus: false });
                }
            } else {
                this.blurFocusBox();
            }
        });
        this.teleBoxManager.events.on("dark_mode", darkMode => {
            callbacks.emit("darkModeChange", darkMode);
        });
        this.teleBoxManager.events.on("prefers_color_scheme", colorScheme => {
            callbacks.emit("prefersColorSchemeChange", colorScheme);
        });
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
        this.teleBoxManager.create(createBoxConfig);
        emitter.emit(`${params.appId}${Events.WindowCreated}` as any);
    }

    public setBoxInitState(appId: string): void {
        const box = this.teleBoxManager.queryOne({ id: appId });
        if (box) {
            if (box.state === TELE_BOX_STATE.Maximized) {
                emitter.emit("resize", {
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
        const container = createTeleBoxManagerConfig?.collectorContainer || WindowManager.wrapper;
        const styles = {
            ...DEFAULT_COLLECTOR_STYLE,
            ...createTeleBoxManagerConfig?.collectorStyles,
        };
        const teleBoxCollector = new TeleBoxCollector({
            styles: styles,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        }).mount(container!);
        initManagerState.collector = teleBoxCollector;
        const manager = new TeleBoxManager(initManagerState);
        if (this.teleBoxManager) {
            this.teleBoxManager.destroy();
        }
        this.teleBoxManager = manager;
        return manager;
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
        const boxes = this.teleBoxManager.query();
        return maxBy(boxes, "zIndex");
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
                },
                true
            );
            if (state.maximized != null) {
                this.teleBoxManager.setMaximized(Boolean(state.maximized), true);
                this.teleBoxManager.setMinimized(Boolean(state.minimized), true);
            }
            setTimeout(() => {
                if (state.focus) {
                    this.teleBoxManager.update(box.id, { focus: true }, true);
                }
            }, 50);
            callbacks.emit("boxStateChange", this.teleBoxManager.state);
        }
    }

    public updateManagerRect(): void {
        const rect = this.mainView.divElement?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            const containerRect = { x: 0, y: 0, width: rect.width, height: rect.height };
            this.teleBoxManager.setContainerRect(containerRect);
            this.manager.notifyContainerRectUpdate(this.teleBoxManager.containerRect);
        }
    }

    public moveBox({ appId, x, y }: MoveBoxParams): void {
        this.teleBoxManager.update(appId, { x, y }, true);
    }

    public focusBox({ appId }: AppId, skipUpdate = true): void {
        this.teleBoxManager.update(appId, { focus: true }, skipUpdate);
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
        this.teleBoxManager.updateAll({ focus: false });
    }

    public blurFocusBox(): void {
        const focusBoxes = this.teleBoxManager.query({ focus: true });
        if (focusBoxes.length) {
            const box = focusBoxes[0];
            this.teleBoxManager.update(box.id, { focus: false });
        }
    }

    public updateAll(config: TeleBoxManagerUpdateConfig): void {
        this.teleBoxManager.updateAll(config);
    }

    public setMaximized(maximized: boolean) {
        this.teleBoxManager.setMaximized(maximized, true);
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

    public setReadonly(readonly: boolean) {
        this.teleBoxManager.setReadonly(readonly);
    }

    public setPrefersColorScheme(colorScheme: TeleBoxColorScheme) {
        this.teleBoxManager.setPrefersColorScheme(colorScheme);
    }

    public destroy() {
        this.teleBoxManager.destroy();
    }
}
