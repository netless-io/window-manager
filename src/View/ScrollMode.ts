import { AnimationMode } from "white-web-sdk";
import { callbacks } from "../callback";
import { combine, derive, Val } from "value-enhancer";
import { createScrollStorage } from "../storage";
import { SCROLL_MODE_BASE_HEIGHT, SCROLL_MODE_BASE_WIDTH } from "../constants";
import { SideEffectManager } from "side-effect-manager";
import { round } from "lodash";
import type { ReadonlyVal } from "value-enhancer";
import type { AppManager } from "../AppManager";
import type { ScrollStorage } from "../storage";
import type { Camera, Size } from "white-web-sdk";

function clamp(x: number, min: number, max: number): number {
    return x < min ? min : x > max ? max : x;
}

export type ScrollState = {
    scrollTop: number;
    page: number;
    maxScrollPage: number;
};

export class ScrollMode {
    public readonly sideEffect = new SideEffectManager();

    private readonly _root$: Val<HTMLElement | null>;
    private readonly _whiteboard$: ReadonlyVal<HTMLElement | null>;
    private readonly _scrollTop$: Val<number>;
    private readonly _page$: ReadonlyVal<number>;
    private readonly _scale$: ReadonlyVal<number>;
    private readonly _size$: Val<Size>;

    private baseWidth = SCROLL_MODE_BASE_WIDTH;
    private baseHeight = SCROLL_MODE_BASE_HEIGHT;

    public readonly scrollStorage: ScrollStorage;
    public readonly scrollState$: ReadonlyVal<ScrollState>;

    get mainView() {
        return this.manager.mainView;
    }

    public setRoot(root: HTMLElement): void {
        this._root$.setValue(root);
    }

    constructor(private manager: AppManager) {
        this._root$ = new Val<HTMLElement | null>(null);
        // 滚动模式下确保 disableCameraTransform 为 false, 否则触摸屏无法滚动
        this.mainView.disableCameraTransform = false;

        if (manager.scrollBaseSize$?.value) {
            this.baseWidth = manager.scrollBaseSize$.value.width;
            this.baseHeight = manager.scrollBaseSize$.value.height;
        }

        this.scrollStorage = createScrollStorage(manager);
        const scrollTop$ = new Val(this.scrollStorage.state.scrollTop);
        this._scrollTop$ = scrollTop$;

        this.sideEffect.push(
            this.scrollStorage.on("stateChanged", () => {
                this._scrollTop$.setValue(this.scrollStorage.state.scrollTop);
            })
        );

        const size$ = new Val<Size>(
            { width: 0, height: 0 },
            { compare: (a, b) => a.width === b.width && a.height === b.height }
        );
        this._size$ = size$;
        this.sideEffect.add(() => {
            const onSizeUpdated = size$.setValue.bind(size$);
            onSizeUpdated(this.mainView.size);
            this.mainView.callbacks.on("onSizeUpdated", onSizeUpdated);
            return () => this.mainView.callbacks.off("onSizeUpdated", onSizeUpdated);
        });

        this.sideEffect.add(() => {
            const onCameraUpdated = (camera: Camera): void => {
                if (!this.manager.canOperate) return;
                const halfWbHeight = size$.value.height / 2 / scale$.value;
                const scrollTop = camera.centerY;
                this.scrollStorage.setState({
                    scrollTop: clamp(scrollTop, halfWbHeight, this.baseHeight - halfWbHeight),
                });
                callbacks.emit("userScroll");
            };
            this.mainView.callbacks.on("onCameraUpdatedByDevice", onCameraUpdated);
            return () =>
                this.mainView.callbacks.off("onCameraUpdatedByDevice", onCameraUpdated);
        });

        const scale$ = derive(size$, size => size.width / this.baseWidth);
        this._scale$ = scale$;

        const page$ = new Val(0);
        this.sideEffect.push(
            combine([scrollTop$, size$, scale$]).subscribe(([scrollTop, size, scale]) => {
                if (scale > 0) {
                    const wbHeight = size.height / scale;
                    page$.setValue(Math.max(scrollTop / wbHeight - 0.5, 0));
                }
            })
        );
        this._page$ = page$;

        // 5. bound$ = { contentMode: () => scale$, centerX: W / 2, centerY: H / 2, width: W, height: H }
        this.sideEffect.push(
            combine([scrollTop$, scale$]).subscribe(([scrollTop, scale]) => {
                this.updateBound(scrollTop, size$.value, scale);
            })
        );

        this.sideEffect.push(
            size$.reaction(() => {
                this.updateScroll(scrollTop$.value);
            })
        );

        const whiteboard$ = derive(this._root$, this.getWhiteboardElement);
        this._whiteboard$ = whiteboard$;
        this.sideEffect.push(
            whiteboard$.reaction(el => {
                if (el?.parentElement) {
                    this.sideEffect.addEventListener(
                        el.parentElement,
                        "wheel",
                        this.onWheel,
                        { capture: true, passive: false },
                        "wheel"
                    );
                }
            })
        );

        const maxScrollPage$ = combine([this._size$, this._scale$], ([size, scale]) => {
            const halfWbHeight = size.height / 2 / scale;
            return (this.baseHeight - halfWbHeight) / halfWbHeight / 2 - 0.51;
        });

        this.scrollState$ = combine(
            [this._scrollTop$, this._page$, maxScrollPage$],
            ([scrollTop, page, maxScrollPage]) => {
                return {
                    scrollTop: round(scrollTop, 2),
                    page: round(page, 2),
                    maxScrollPage: round(maxScrollPage, 2),
                };
            }
        );

        this.updateScroll(scrollTop$.value);
        this.sideEffect.push(
            this.scrollState$.subscribe(state => callbacks.emit("scrollStateChange", state))
        );

        this.sideEffect.push(
            combine([this._size$, this._scale$]).subscribe(([size, scale]) => {
                if (size.height > 0 && scale > 0) {
                    this.initScroll();
                    this.sideEffect.flush("initScroll");
                }
            }),
            "initScroll"
        );
    }

    private initScroll = (): void => {
        const halfWbHeight = this._size$.value.height / 2 / this._scale$.value;
        const scrollTop = this._scrollTop$.value;
        // HACK: set a different value (+0.01) to trigger all effects above
        this._scrollTop$.setValue(
            clamp(scrollTop, halfWbHeight, this.baseHeight - halfWbHeight) - 0.01
        );
    };

    private updateScroll(scrollTop: number): void {
        this.mainView.moveCamera({
            centerY: scrollTop,
            animationMode: AnimationMode.Immediately,
        });
    }

    private updateBound(scrollTop: number, { height }: Size, scale: number): void {
        if (scale > 0) {
            this.mainView.moveCameraToContain({
                originX: 0,
                originY: scrollTop - height / scale / 2,
                width: this.baseWidth,
                height: height / scale,
                animationMode: AnimationMode.Immediately,
            });

            this.mainView.setCameraBound({
                damping: 1,
                maxContentMode: () => scale,
                minContentMode: () => scale,
                centerX: this.baseWidth / 2,
                centerY: this.baseHeight / 2,
                width: this.baseWidth,
                height: this.baseHeight,
            });
        }
    }

    public dispose(): void {
        this.sideEffect.flushAll();
        this.scrollStorage.disconnect();
        this._root$.destroy();
        this._scale$.destroy();
        this._scrollTop$.destroy();
        this._whiteboard$.destroy();
        this.scrollState$.destroy();
        this._page$.destroy();
        this._size$.destroy();
    }

    private getWhiteboardElement = (root: HTMLElement | null): HTMLElement | null => {
        const className = ".netless-window-manager-main-view";
        return root && root.querySelector(className);
    };

    private shouldBroadcast() {
        return this.manager.canOperate && this.manager.room?.disableDeviceInputs === false;
    }

    private onWheel = (ev: WheelEvent): void => {
        const target = ev.target as HTMLElement | null;
        if (this._whiteboard$.value?.contains(target)) {
            ev.preventDefault();
            ev.stopPropagation();
            const dy = ev.deltaY || 0;
            const { width } = this._size$.value;
            if (this.shouldBroadcast() && dy && width > 0) {
                const halfWbHeight = this._size$.value.height / 2 / this._scale$.value;
                const scrollTop = this._scrollTop$.value + dy / this._scale$.value;
                this.scrollStorage.setState({
                    scrollTop: clamp(scrollTop, halfWbHeight, this.baseHeight - halfWbHeight),
                });
                callbacks.emit("userScroll");
            }
        }
    };
}
