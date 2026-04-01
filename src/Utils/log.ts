import { WindowManager } from "../index";

export const log = (...args: any[]): void => {
    if (WindowManager.debug) {
        console.log(`[WindowManager]:`, ...args);
    }
};

/**
 * 按 `[window-manager][tagName]` 前缀输出。
 * 若传入 `debounceTime`（毫秒）：窗口内多次 `log` 不立即输出，只在连续停止调用满 `debounceTime` 后输出**最后一次**的参数（尾部 debounce）。
 */
export class LocalConsole {
    private pendingArgs: unknown[] | null = null;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly name: string,
        private readonly debounceTime?: number,
    ) {}

    private flush(): void {
        this.flushTimer = null;
        const args = this.pendingArgs;
        this.pendingArgs = null;
        if (args === null) {
            return;
        }
        console.log(`[window-manager][${this.name}]: ${args.join(", ")}`);
    }

    log(...args: unknown[]): void {
        const ms = this.debounceTime;
        if (ms != null && ms > 0) {
            this.pendingArgs = args;
            if (this.flushTimer != null) {
                clearTimeout(this.flushTimer);
            }
            this.flushTimer = setTimeout(() => this.flush(), ms);
            return;
        }
        console.log(`[window-manager][${this.name}]: ${args.join(", ")}`);
    }
}
