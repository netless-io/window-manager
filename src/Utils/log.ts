import type { Logger } from "white-web-sdk";
import { isShallowMergeAttributesRecord, stringifyForAttributesLog } from "./attributesLogStringify";
import { WindowManager } from "../index";

/** ArgusLog 经 `logger.info` 上报的单条字符串上限（含前缀） */
const ARGUS_LOG_INFO_MAX_LENGTH = 1500;

function truncateArgusLogInfoMessage(message: string): string {
    if (message.length <= ARGUS_LOG_INFO_MAX_LENGTH) {
        return message;
    }
    const ellipsis = "…";
    return message.slice(0, ARGUS_LOG_INFO_MAX_LENGTH - ellipsis.length) + ellipsis;
}

function keysPathEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

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

    /**
     * 销毁：清除 debounce 定时器与未输出的暂存参数。
     * 持有 LocalConsole 的类在销毁时应调用。
     */
    destroy(): void {
        if (this.flushTimer != null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.pendingArgs = null;
    }
}

/**
 * 按 `[WindowManager][tagName]` 前缀输出。
 * 若传入 `debounceTime`（毫秒）：窗口内多次 `log` 不立即输出，只在连续停止调用满 `debounceTime` 后输出**最后一次**的参数（尾部 debounce）。
 */
export class ArgusLog {
    private pendingArgs: unknown[] | null = null;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    /** debounce 窗口内按一层 key 合并；同 key 后者覆盖；非普通对象则整段待输出被本次值替换 */
    private pendingShallowMerge:
        | { kind: "record"; label: string; data: Record<string, unknown> }
        | { kind: "atom"; label: string; value: unknown }
        | null = null;
    private shallowMergeTimer: ReturnType<typeof setTimeout> | null = null;

    /** debounce 窗口内 safeUpdateAttributes：同 keys 数组则只更新 value，否则追加一段，flush 时拼成一条 */
    private pendingUpdateSegments: { keys: string[]; value: unknown }[] | null = null;
    private updateMergeTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly logger: Logger,
        private readonly name: string,
        private readonly debounceTime?: number,
    ) {}

    private emitInfo(message: string): void {
        this.logger.info(truncateArgusLogInfoMessage(message));
    }

    private flush(): void {
        this.flushTimer = null;
        const args = this.pendingArgs;
        this.pendingArgs = null;
        if (args === null) {
            return;
        }
        this.emitInfo(`[WindowManager][${this.name}]: ${args.join(", ")}`);
    }

    private flushShallowMerge(): void {
        this.shallowMergeTimer = null;
        const p = this.pendingShallowMerge;
        this.pendingShallowMerge = null;
        if (p === null) {
            return;
        }
        const body =
            p.kind === "record" ? stringifyForAttributesLog(p.data) : stringifyForAttributesLog(p.value);
        this.emitInfo(`[WindowManager][${this.name}]: ${p.label} ${body}`);
        // 输出后释放合并对象引用，避免长时间持有 attributes 快照
        if (p.kind === "record") {
            for (const k of Object.keys(p.data)) {
                delete p.data[k];
            }
        }
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
        this.emitInfo(`[WindowManager][${this.name}]: ${args.join(", ")}`);
    }

    /**
     * 带 debounce 时：窗口内多次调用会把「一层 key」合并进同一条日志（不同 key 并存，同 key 取最后一次）。
     * `payload` 为普通对象时做浅合并；否则视为原子值，覆盖当前待合并状态（丢弃此前累积的对象 key）。
     * 无 debounce 或时间为 0 时立即输出。
     */
    logDebouncedShallowMerge(label: string, payload: unknown): void {
        const ms = this.debounceTime;
        const debounced = ms != null && ms > 0;

        const emit = (text: string): void => {
            this.emitInfo(`[WindowManager][${this.name}]: ${label} ${text}`);
        };

        if (!debounced) {
            emit(stringifyForAttributesLog(payload));
            return;
        }

        if (this.shallowMergeTimer != null) {
            clearTimeout(this.shallowMergeTimer);
            this.shallowMergeTimer = null;
        }

        if (isShallowMergeAttributesRecord(payload)) {
            if (this.pendingShallowMerge?.kind === "record") {
                this.pendingShallowMerge = {
                    kind: "record",
                    label,
                    data: { ...this.pendingShallowMerge.data, ...payload },
                };
            } else {
                this.pendingShallowMerge = { kind: "record", label, data: { ...payload } };
            }
        } else {
            this.pendingShallowMerge = { kind: "atom", label, value: payload };
        }

        this.shallowMergeTimer = setTimeout(() => this.flushShallowMerge(), ms);
    }

    private flushUpdateAttributesMerge(): void {
        this.updateMergeTimer = null;
        const segments = this.pendingUpdateSegments;
        this.pendingUpdateSegments = null;
        if (segments === null || segments.length === 0) {
            return;
        }
        const parts = segments.map(
            (s) => `${s.keys.join(", ")} ${stringifyForAttributesLog(s.value)}`,
        );
        this.emitInfo(`[WindowManager][${this.name}]: safeUpdateAttributes ${parts.join(" | ")}`);
        for (const s of segments) {
            s.keys.length = 0;
            s.value = undefined;
        }
        segments.length = 0;
    }

    /**
     * 带 debounce 时：连续调用若 `keys` 与上一段完全相同则覆盖该段的 `value`；否则追加一段。
     * flush 时输出一条日志，多段用 ` | ` 连接。
     */
    logDebouncedUpdateAttributes(keys: string[], value: unknown): void {
        const ms = this.debounceTime;
        const debounced = ms != null && ms > 0;
        const keysCopy = [...keys];

        if (!debounced) {
            this.emitInfo(
                `[WindowManager][${this.name}]: safeUpdateAttributes ${keysCopy.join(", ")} ${stringifyForAttributesLog(value)}`,
            );
            return;
        }

        if (this.updateMergeTimer != null) {
            clearTimeout(this.updateMergeTimer);
            this.updateMergeTimer = null;
        }

        if (this.pendingUpdateSegments === null || this.pendingUpdateSegments.length === 0) {
            this.pendingUpdateSegments = [{ keys: keysCopy, value }];
        } else {
            const last = this.pendingUpdateSegments[this.pendingUpdateSegments.length - 1];
            if (keysPathEqual(last.keys, keysCopy)) {
                last.value = value;
            } else {
                this.pendingUpdateSegments.push({ keys: keysCopy, value });
            }
        }

        this.updateMergeTimer = setTimeout(() => this.flushUpdateAttributesMerge(), ms);
    }

    /**
     * 销毁：清除所有 `setTimeout` debounce 定时器，并丢弃尚未输出的暂存日志（不补打日志）。
     * WindowManager 销毁时应调用，避免泄漏与销毁后仍触发 `logger.info`。
     */
    destroy(): void {
        if (this.flushTimer != null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.shallowMergeTimer != null) {
            clearTimeout(this.shallowMergeTimer);
            this.shallowMergeTimer = null;
        }
        if (this.updateMergeTimer != null) {
            clearTimeout(this.updateMergeTimer);
            this.updateMergeTimer = null;
        }
        this.pendingArgs = null;
        this.pendingShallowMerge = null;
        this.pendingUpdateSegments = null;
    }

    /** 与 `destroy()` 相同，保留旧名以兼容 */
    dispose(): void {
        this.destroy();
    }
}
