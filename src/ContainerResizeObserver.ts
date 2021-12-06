import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";
import { WindowManager } from "./index";
import type { CursorManager } from "./Cursor";

const ResizeObserver = window.ResizeObserver || ResizeObserverPolyfill;

export class ContainerResizeObserver {
    private containerResizeObserver?: ResizeObserver;

    constructor(private cursorManager?: CursorManager) {}

    public static create(
        container: HTMLElement,
        sizer: HTMLElement,
        wrapper: HTMLDivElement,
        cursorManager?: CursorManager
    ) {
        const containerResizeObserver = new ContainerResizeObserver(cursorManager);
        containerResizeObserver.observePlaygroundSize(container, sizer, wrapper);
        return containerResizeObserver;
    }

    public observePlaygroundSize(
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

    public disconnect() {
        this.containerResizeObserver?.disconnect();
    }
}
