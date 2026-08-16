import type { View } from "white-web-sdk";

export type AppBoxSize = { width: number; height: number };
export type AppBoxSizeChange = AppBoxSize & { appId: string };

type ViewWithRefreshSize = View & {
    refreshSize?: (width: number, height: number) => void;
    screen?: {
        refreshSize?: (width: number, height: number) => void;
        resizeObserver?: {
            disconnect?: () => void;
            observe?: (target: Element) => void;
        };
    };
};

const BOX_SIZE_EPSILON = 0.5;
const BOX_SIZE_SETTLE_DELAY = 650;
const BOX_SIZE_CONFIRM_DELAY = 100;

const sizesEqual = (left: AppBoxSize | undefined, right: AppBoxSize): boolean =>
    Boolean(
        left &&
            Math.abs(left.width - right.width) <= BOX_SIZE_EPSILON &&
            Math.abs(left.height - right.height) <= BOX_SIZE_EPSILON
    );

export class AppBoxSizeSynchronizer {
    private frame?: number;
    private timer?: ReturnType<typeof setTimeout>;
    private pendingSize?: AppBoxSize;
    private lastNotifiedSize?: AppBoxSize;
    private destroyed = false;

    public constructor(
        private readonly appId: string,
        private readonly getView: () => View | undefined,
        private readonly getElement: () => Element | undefined,
        private readonly notify: (payload: AppBoxSizeChange) => void,
        private readonly onError?: (error: unknown) => void
    ) {}

    public schedule = (): void => {
        if (this.destroyed) return;
        if (this.timer != null) clearTimeout(this.timer);
        if (this.frame != null) {
            cancelAnimationFrame(this.frame);
            this.frame = undefined;
        }
        this.pendingSize = undefined;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.frame = requestAnimationFrame(this.confirmDOMSize);
        }, BOX_SIZE_SETTLE_DELAY);
    };

    public destroy(): void {
        this.destroyed = true;
        if (this.timer != null) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.frame != null) {
            cancelAnimationFrame(this.frame);
            this.frame = undefined;
        }
        this.pendingSize = undefined;
        this.lastNotifiedSize = undefined;
    }

    private confirmDOMSize = (): void => {
        this.frame = undefined;
        if (this.destroyed) return;

        const element = this.getElement();
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const size = { width: rect.width, height: rect.height };
        if (
            !Number.isFinite(size.width) ||
            !Number.isFinite(size.height) ||
            size.width <= 0 ||
            size.height <= 0
        ) {
            this.pendingSize = undefined;
            return;
        }

        if (!sizesEqual(this.pendingSize, size)) {
            this.pendingSize = size;
            this.timer = setTimeout(() => {
                this.timer = undefined;
                this.frame = requestAnimationFrame(this.confirmDOMSize);
            }, BOX_SIZE_CONFIRM_DELAY);
            return;
        }

        this.pendingSize = undefined;
        const view = this.getView() as ViewWithRefreshSize | undefined;
        if (view && !sizesEqual(view.size, size)) {
            try {
                if (typeof view.refreshSize === "function") {
                    view.refreshSize(size.width, size.height);
                } else if (typeof view.screen?.refreshSize === "function") {
                    const resizeObserver = view.screen.resizeObserver;
                    resizeObserver?.disconnect?.();
                    try {
                        view.screen.refreshSize(size.width, size.height);
                    } finally {
                        if (view.divElement) resizeObserver?.observe?.(view.divElement);
                    }
                }
            } catch (error) {
                this.onError?.(error);
            }
        }

        if (!sizesEqual(this.lastNotifiedSize, size)) {
            this.lastNotifiedSize = size;
            this.notify({ appId: this.appId, ...size });
        }
    };
}
