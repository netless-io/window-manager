import type { Logger } from "white-web-sdk";
import {
    isShallowMergeAttributesRecord,
    stringifyForAttributesLog,
} from "./attributesLogStringify";
import { WindowManager } from "../index";
import { ROOM_LOG_DEBOUNCE_MIN } from "../constants";

/** 经 Room logger 上报的单条字符串上限（含前缀） */
const ROOM_LOG_MAX_LENGTH = 1500;

const SENSITIVE_KEY_PATTERN = /token|authorization|credential|secret|signature/i;
const SENSITIVE_QUERY_PATTERN =
    /([?&](?:token|roomToken|signature|authorization|credential|secret)=)[^&\s]*/gi;
const NETLESS_ROOM_TOKEN_PATTERN = /NETLESSROOM_[A-Za-z0-9_=-]+/g;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]*/gi;

export type AppLoggerOptions = {
    /** Trailing debounce delay for `debouncedInfo()`. Default/minimum: 300ms. */
    debounceTime?: number;
    /** Force a pending event to be emitted during continuous calls. Default: 2000ms. */
    maxWaitTime?: number;
};

export interface AppLogger {
    debug(event: string, payload?: unknown): void;
    info(event: string, payload?: unknown): void;
    warn(event: string, payload?: unknown): void;
    /** Error logs are always emitted immediately and are never debounced. */
    error(event: string, error: unknown, payload?: unknown): void;
    /** Debounced independently by event name. */
    debouncedInfo(event: string, payload?: unknown): void;
    /** Flush all pending debounced info logs immediately. */
    flush(): void;
}

export type AppLoggerContext = {
    kind: string;
    appId: string;
    uid?: string;
};

type LogLevel = "debug" | "info" | "warn" | "error";

function redactSensitiveText(text: string): string {
    return text
        .replace(URL_QUERY_PATTERN, "$1?[REDACTED]")
        .replace(SENSITIVE_QUERY_PATTERN, "$1[REDACTED]")
        .replace(NETLESS_ROOM_TOKEN_PATTERN, "NETLESSROOM_[REDACTED]");
}

function serializeLogValue(
    value: unknown,
    seen = new WeakSet<Record<PropertyKey, unknown>>(),
    depth = 0
): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(redactSensitiveText(value));
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol" || typeof value === "function") return String(value);
    if (depth >= 6) return "[MaxDepth]";

    const object = value as Record<PropertyKey, unknown>;
    if (seen.has(object)) return "[Circular]";
    seen.add(object);
    try {
        if (value instanceof Error) {
            return serializeLogValue(
                { name: value.name, message: value.message, stack: value.stack },
                seen,
                depth + 1
            );
        }
        if (value instanceof Date) return JSON.stringify(value.toISOString());
        if (value instanceof RegExp) return JSON.stringify(String(value));
        if (Array.isArray(value)) {
            return `[${value
                .slice(0, 50)
                .map(item => serializeLogValue(item, seen, depth + 1))
                .join(",")}${value.length > 50 ? ',"[Truncated]"' : ""}]`;
        }

        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).slice(0, 50);
        const parts = keys.map(key => {
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                return `${JSON.stringify(key)}:"[REDACTED]"`;
            }
            let item: unknown;
            try {
                item = record[key];
            } catch {
                item = "[Threw]";
            }
            return `${JSON.stringify(key)}:${serializeLogValue(item, seen, depth + 1)}`;
        });
        if (Object.keys(record).length > keys.length) parts.push('"[Truncated]":true');
        return `{${parts.join(",")}}`;
    } catch {
        return "[Unserializable]";
    } finally {
        seen.delete(object);
    }
}

function truncateRoomLogMessage(message: string): string {
    if (message.length <= ROOM_LOG_MAX_LENGTH) {
        return message;
    }
    const suffix = "...[truncated]";
    return message.slice(0, ROOM_LOG_MAX_LENGTH - suffix.length) + suffix;
}

function formatLoggerArguments(messages: unknown[]): string {
    if (messages.length === 1 && typeof messages[0] === "string") {
        return redactSensitiveText(messages[0]);
    }
    return messages
        .map(message =>
            typeof message === "string" ? redactSensitiveText(message) : serializeLogValue(message)
        )
        .join(" ");
}

function emitManagedRoomLog(logger: Logger, level: LogLevel, messages: unknown[]): void {
    try {
        const printer = logger[level];
        if (typeof printer === "function") {
            printer.call(logger, truncateRoomLogMessage(formatLoggerArguments(messages)));
        }
    } catch (error) {
        if (WindowManager.debug) {
            console.warn("[WindowManager]: room logger failed", level, error);
        }
    }
}

/**
 * Wrap the SDK room logger so every WindowManager internal log uses the same
 * redaction, serialization and length limit.
 */
export function createManagedRoomLogger(logger: Logger): Logger {
    const managed = {
        context: logger.context,
        debug: (...messages: unknown[]) => emitManagedRoomLog(logger, "debug", messages),
        info: (...messages: unknown[]) => emitManagedRoomLog(logger, "info", messages),
        warn: (...messages: unknown[]) => emitManagedRoomLog(logger, "warn", messages),
        error: (...messages: unknown[]) => emitManagedRoomLog(logger, "error", messages),
        withContext: (context: Record<string, unknown>) => {
            try {
                return createManagedRoomLogger(
                    typeof logger.withContext === "function" ? logger.withContext(context) : logger
                );
            } catch {
                return createManagedRoomLogger(logger);
            }
        },
    };
    return managed as unknown as Logger;
}

type PendingAppLog = {
    payload: unknown;
    debounceTimer?: ReturnType<typeof setTimeout>;
    maxWaitTimer?: ReturnType<typeof setTimeout>;
};

export class ScopedAppLogger implements AppLogger {
    private readonly debounceTime: number;
    private readonly maxWaitTime: number;
    private readonly pending = new Map<string, PendingAppLog>();
    private destroyed = false;

    constructor(
        private readonly logger: Logger | undefined,
        private readonly scope: string,
        private readonly context: AppLoggerContext,
        options: AppLoggerOptions = {}
    ) {
        this.debounceTime = Math.max(
            ROOM_LOG_DEBOUNCE_MIN,
            options.debounceTime ?? ROOM_LOG_DEBOUNCE_MIN
        );
        this.maxWaitTime = Math.max(this.debounceTime, options.maxWaitTime ?? 2000);
    }

    debug(event: string, payload?: unknown): void {
        this.emit("debug", event, payload);
    }

    info(event: string, payload?: unknown): void {
        this.emit("info", event, payload);
    }

    warn(event: string, payload?: unknown): void {
        this.emit("warn", event, payload);
    }

    error(event: string, error: unknown, payload?: unknown): void {
        this.emit("error", event, payload, error);
    }

    debouncedInfo(event: string, payload?: unknown): void {
        if (this.destroyed || !this.logger) return;
        let pending = this.pending.get(event);
        if (!pending) {
            pending = { payload };
            this.pending.set(event, pending);
            pending.maxWaitTimer = setTimeout(() => this.flushEvent(event), this.maxWaitTime);
        } else {
            pending.payload = payload;
        }
        if (pending.debounceTimer != null) clearTimeout(pending.debounceTimer);
        pending.debounceTimer = setTimeout(() => this.flushEvent(event), this.debounceTime);
    }

    flush(): void {
        for (const event of Array.from(this.pending.keys())) this.flushEvent(event);
    }

    destroy(flushPending = true): void {
        if (this.destroyed) return;
        if (flushPending) this.flush();
        for (const pending of this.pending.values()) this.clearPendingTimers(pending);
        this.pending.clear();
        this.destroyed = true;
    }

    private flushEvent(event: string): void {
        const pending = this.pending.get(event);
        if (!pending) return;
        this.pending.delete(event);
        this.clearPendingTimers(pending);
        this.emit("info", event, pending.payload);
    }

    private clearPendingTimers(pending: PendingAppLog): void {
        if (pending.debounceTimer != null) clearTimeout(pending.debounceTimer);
        if (pending.maxWaitTimer != null) clearTimeout(pending.maxWaitTimer);
    }

    private emit(level: LogLevel, event: string, payload?: unknown, error?: unknown): void {
        if (this.destroyed || !this.logger) return;
        const metadata = { ...this.context, scope: this.scope, event };
        let message = `[WindowManager][App] ${serializeLogValue(metadata)}`;
        if (error !== undefined) message += ` error=${serializeLogValue(error)}`;
        if (payload !== undefined) message += ` payload=${serializeLogValue(payload)}`;
        this.logger[level](message);
    }
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
 * Local debug console. This does not write to Room logger or the upload pipeline.
 * When debounced, only the latest arguments are printed after calls settle.
 */
export class LocalConsole {
    private pendingArgs: unknown[] | null = null;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly name: string, private readonly debounceTime?: number) {}

    private flush(): void {
        this.flushTimer = null;
        const args = this.pendingArgs;
        this.pendingArgs = null;
        if (args === null) return;
        console.log(`[window-manager][${this.name}]: ${args.join(", ")}`);
    }

    log(...args: unknown[]): void {
        const ms = this.debounceTime;
        if (ms != null && ms > 0) {
            this.pendingArgs = args;
            if (this.flushTimer != null) clearTimeout(this.flushTimer);
            this.flushTimer = setTimeout(() => this.flush(), ms);
            return;
        }
        console.log(`[window-manager][${this.name}]: ${args.join(", ")}`);
    }

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

    private readonly debounceTime?: number;

    constructor(
        private readonly logger: Logger,
        private readonly name: string,
        debounceTime?: number
    ) {
        this.debounceTime =
            debounceTime == null ? undefined : Math.max(ROOM_LOG_DEBOUNCE_MIN, debounceTime);
    }

    private emitInfo(message: string): void {
        this.logger.info(truncateRoomLogMessage(message));
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
            p.kind === "record"
                ? stringifyForAttributesLog(p.data)
                : stringifyForAttributesLog(p.value);
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
            s => `${s.keys.join(", ")} ${stringifyForAttributesLog(s.value)}`
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
                `[WindowManager][${this.name}]: safeUpdateAttributes ${keysCopy.join(
                    ", "
                )} ${stringifyForAttributesLog(value)}`
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
