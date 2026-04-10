/** 合法标识符形式的 key 省略引号，形如 `{aaa:undefined}` */
function formatAttributesLogObjectKey(key: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * attributes 调试日志：对象/数组会写成近似 JS 字面量（保留 `undefined`、数组空洞），避免 `[object Object]`；
 * 并处理 BigInt、循环引用等。
 */
export function stringifyForAttributesLog(value: unknown, seen?: WeakSet<object>): string {
    if (value === undefined) {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    const t = typeof value;
    if (t === "bigint") {
        return `${value}n`;
    }
    if (t === "symbol") {
        return String(value);
    }
    if (t === "function") {
        const fn = value as (...args: unknown[]) => unknown;
        return `[Function ${fn.name || "anonymous"}]`;
    }
    if (t !== "object") {
        return t === "string" ? JSON.stringify(value as string) : String(value);
    }

    const obj = value as object;
    if (seen?.has(obj)) {
        return "[Circular]";
    }

    const nextSeen = seen ?? new WeakSet<object>();
    nextSeen.add(obj);
    try {
        if (Array.isArray(value)) {
            return `[${Array.from(value as unknown[], (item) =>
                stringifyForAttributesLog(item, nextSeen),
            ).join(",")}]`;
        }
        if (value instanceof Date) {
            return JSON.stringify(value.toISOString());
        }
        if (value instanceof RegExp) {
            return String(value);
        }
        const keys = Object.keys(value as object);
        const pairs = keys.map((k) => {
            let v: unknown;
            try {
                v = (value as Record<string, unknown>)[k];
            } catch {
                return `${formatAttributesLogObjectKey(k)}:[Threw]`;
            }
            return `${formatAttributesLogObjectKey(k)}:${stringifyForAttributesLog(v, nextSeen)}`;
        });
        return `{${pairs.join(",")}}`;
    } catch {
        return "[Unserializable]";
    } finally {
        nextSeen.delete(obj);
    }
}

/** 仅一层 key 合并：可作为 attributes 片段的「普通对象」（非数组、Date 等） */
export function isShallowMergeAttributesRecord(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !(value instanceof RegExp)
    );
}
