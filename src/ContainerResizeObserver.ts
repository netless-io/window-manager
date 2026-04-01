import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
import { isFunction } from "lodash";
import { WindowManager } from "./index";
import type { EmitterType } from "./InternalEmitter";
import type { UnsubscribeFn } from "emittery";
import { LocalConsole } from "./Utils/log";

const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

export class ContainerResizeObserver {
    private containerResizeObserver?: ResizeObserver;
    private disposer?: UnsubscribeFn;
    
    private updateSizerLocalConsole = new LocalConsole("updateSizer", 30);

    constructor(private emitter: EmitterType) {}

    public static create(
        container: HTMLElement,
        sizer: HTMLElement,
        wrapper: HTMLDivElement,
        emitter: EmitterType
    ) {
        const containerResizeObserver = new ContainerResizeObserver(emitter);
        containerResizeObserver.observePlaygroundSize(container, sizer, wrapper);
        return containerResizeObserver;
    }

    public observePlaygroundSize(
        container: HTMLElement,
        sizer: HTMLElement,
        wrapper: HTMLDivElement
    ) {
        this.updateSizer(container.getBoundingClientRect(), sizer, wrapper, 'observePlaygroundSize');

        this.containerResizeObserver = new ResizeObserver(entries => {
            const containerRect = entries[0]?.contentRect;
            if (containerRect) {
                this.updateSizer(containerRect, sizer, wrapper, 'containerResizeObserver');
                this.emitter.emit("playgroundSizeChange", containerRect);
            }
        });

        this.disposer = this.emitter.on("containerSizeRatioUpdate", () => {
            const containerRect = container.getBoundingClientRect();
            this.updateSizer(containerRect, sizer, wrapper, 'containerSizeRatioUpdate');
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
            this.updateSizerLocalConsole.log(`from ${origin}, traget size: ${JSON.stringify({ width, height })}, wrapperRect: ${wrapperRect.width} ${wrapperRect.height}`);
            this.emitter.emit("wrapperRectChange", {
                width: wrapperRect.width,
                height: wrapperRect.height,
                origin,
            });
        }
    }

    public disconnect() {
        this.containerResizeObserver?.disconnect();
        if (isFunction(this.disposer)) {
            this.disposer();
            this.disposer = undefined;
        }
    }
}
