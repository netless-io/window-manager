import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
import { WindowManager } from "./index";
import type { EmitterType } from "./InternalEmitter";
import type { UnsubscribeFn } from "emittery";
import type { Logger } from "white-web-sdk";
import { CONTAINER_STATE_LOG_DEBOUNCE } from "./constants";
import { ArgusLog } from "./Utils/log";

const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

export type ContainerInternalState = {
    mainViewElement?: HTMLElement;
    mainViewSize?: Pick<DOMRectReadOnly, "width" | "height">;
    teleBoxContainerRect?: Pick<DOMRectReadOnly, "width" | "height">;
    mainViewDidRelease?: boolean;
    containerSizeRatio?: number;
};

export class ContainerResizeObserver {
    private containerResizeObserver?: ResizeObserver;
    private disposer?: UnsubscribeFn;

    private containerStateArgusLog?: ArgusLog;
    private containerStateLogTimer?: ReturnType<typeof setTimeout>;
    private pendingContainerState?: {
        origin?: string;
        observedSize?: Pick<DOMRectReadOnly, "width" | "height">;
    };
    private container?: HTMLElement;
    private sizer?: HTMLElement;
    private wrapper?: HTMLDivElement;

    constructor(
        private emitter: EmitterType,
        logger?: Logger,
        private getInternalState?: () => ContainerInternalState
    ) {
        if (logger) {
            this.containerStateArgusLog = new ArgusLog(logger, "containerState");
        }
    }

    public static create(
        container: HTMLElement,
        sizer: HTMLElement,
        wrapper: HTMLDivElement,
        emitter: EmitterType,
        logger?: Logger,
        getInternalState?: () => ContainerInternalState
    ) {
        const containerResizeObserver = new ContainerResizeObserver(
            emitter,
            logger,
            getInternalState
        );
        containerResizeObserver.observePlaygroundSize(container, sizer, wrapper);
        return containerResizeObserver;
    }

    public observePlaygroundSize(
        container: HTMLElement,
        sizer: HTMLElement,
        wrapper: HTMLDivElement
    ) {
        this.container = container;
        this.sizer = sizer;
        this.wrapper = wrapper;
        this.updateSizer(
            container.getBoundingClientRect(),
            sizer,
            wrapper,
            "observePlaygroundSize"
        );

        this.containerResizeObserver = new ResizeObserver(entries => {
            const containerRect = entries[0]?.contentRect;
            if (containerRect) {
                this.updateSizer(containerRect, sizer, wrapper, "containerResizeObserver");
                this.emitter.emit("playgroundSizeChange", containerRect);
            }
        });

        this.disposer = this.emitter.on("containerSizeRatioUpdate", () => {
            const containerRect = container.getBoundingClientRect();
            this.updateSizer(containerRect, sizer, wrapper, "containerSizeRatioUpdate");
            this.emitter.emit("playgroundSizeChange", containerRect);
        });

        this.containerResizeObserver.observe(container);
    }

    public updateSizer(
        { width, height }: DOMRectReadOnly,
        sizer: HTMLElement,
        wrapper: HTMLDivElement,
        origin?: string
    ) {
        const observedSize = { width, height };
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
            const wrapperRect = wrapper.getBoundingClientRect();
            this.emitter.emit("wrapperRectChange", {
                width: wrapperRect.width,
                height: wrapperRect.height,
                origin,
            });
        }
        this.scheduleContainerStateLog(origin, observedSize);
    }

    public logCurrentState(origin: string): void {
        this.scheduleContainerStateLog(origin);
    }

    private scheduleContainerStateLog(
        origin?: string,
        observedSize?: Pick<DOMRectReadOnly, "width" | "height">
    ): void {
        if (!this.containerStateArgusLog || !this.container || !this.sizer || !this.wrapper) return;

        this.pendingContainerState = {
            origin,
            observedSize: observedSize
                ? { width: observedSize.width, height: observedSize.height }
                : undefined,
        };
        if (this.containerStateLogTimer != null) {
            clearTimeout(this.containerStateLogTimer);
        }
        this.containerStateLogTimer = setTimeout(
            this.flushContainerStateLog,
            CONTAINER_STATE_LOG_DEBOUNCE
        );
    }

    private flushContainerStateLog = (): void => {
        this.containerStateLogTimer = undefined;
        const pendingState = this.pendingContainerState;
        this.pendingContainerState = undefined;
        if (
            !pendingState ||
            !this.containerStateArgusLog ||
            !this.container ||
            !this.sizer ||
            !this.wrapper
        ) {
            return;
        }

        const internalState = this.getInternalState?.();
        const root = this.container.parentElement;
        const rootRect = root?.getBoundingClientRect();
        const playgroundRect = this.container.getBoundingClientRect();
        const sizerRect = this.sizer.getBoundingClientRect();
        const wrapperRect = this.wrapper.getBoundingClientRect();
        const mainViewRect = internalState?.mainViewElement?.getBoundingClientRect();
        const rootStyle = root ? window.getComputedStyle(root) : undefined;
        this.containerStateArgusLog.log(
            `origin: ${pendingState.origin || "unknown"}, connected: ${Boolean(
                root?.isConnected
            )}, ` +
                `observed: ${this.formatSize(
                    pendingState.observedSize || playgroundRect
                )}, root: ${this.formatSize(rootRect)}, playground: ${this.formatSize(
                    playgroundRect
                )}, sizer: ${this.formatSize(sizerRect)}, wrapper: ${this.formatSize(
                    wrapperRect
                )}, mainViewDOM: ${this.formatSize(mainViewRect)}, mainViewSize: ${this.formatSize(
                    internalState?.mainViewSize
                )}, teleBoxRect: ${this.formatSize(
                    internalState?.teleBoxContainerRect
                )}, didRelease: ${internalState?.mainViewDidRelease ?? "unknown"}, ratio: ${
                    internalState?.containerSizeRatio ?? "unknown"
                }, display: ${rootStyle?.display || "unknown"}, visibility: ${
                    rootStyle?.visibility || "unknown"
                }, clientRects: ${root?.getClientRects().length || 0}, inViewport: ${
                    rootRect
                        ? rootRect.bottom > 0 &&
                          rootRect.right > 0 &&
                          rootRect.top < window.innerHeight &&
                          rootRect.left < window.innerWidth
                        : false
                }`
        );
    };

    private formatSize(rect?: Pick<DOMRectReadOnly, "width" | "height">): string {
        if (!rect) return "unknown";
        return `${Math.round(rect.width * 100) / 100}x${Math.round(rect.height * 100) / 100}`;
    }

    public disconnect() {
        if (this.containerStateLogTimer != null) {
            clearTimeout(this.containerStateLogTimer);
            this.containerStateLogTimer = undefined;
        }
        this.pendingContainerState = undefined;
        this.containerStateArgusLog?.destroy();
        this.containerStateArgusLog = undefined;
        this.containerResizeObserver?.disconnect();
        this.disposer?.();
        this.disposer = undefined;
        this.container = undefined;
        this.sizer = undefined;
        this.wrapper = undefined;
        this.getInternalState = undefined;
    }
}
