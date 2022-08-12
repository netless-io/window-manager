import { callbacks } from "../callback";
import { getItem, setItem } from "./storage";
import type { NetlessApp } from "../typings";
import { appRegister } from ".";

const Prefix = "NetlessApp";

const TIMEOUT = 10000; // 下载 script 10 秒超时

export const getScript = async (kind: string, url: string): Promise<string> => {
    const item = await getItem(kind);
    if (item) {
        return item.sourceCode;
    } else {
        const result = await fetchWithTimeout(url, { timeout: TIMEOUT });
        const text = await result.text();
        await setItem(kind, url, text);
        return text;
    }
};

export const executeScript = (text: string, appName: string): NetlessApp => {
    let result = Function(text + `\n;return ${appName}`)();
    if (typeof result === "undefined") {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result = window[appName];
    }
    return result;
};

const emitSuccess = (kind: string, url: string) => {
    callbacks.emit("loadApp", { kind, status: "success" });
    appRegister.downloaded.set(kind, url);
};

const emitFailed = (kind: string, reason: string) => {
    callbacks.emit("loadApp", { kind, status: "failed", reason, });
};

export const loadApp = async (
    url: string,
    key: string,
    name?: string
): Promise<NetlessApp | undefined> => {
    const appName = name || Prefix + key;
    callbacks.emit("loadApp", { kind: key, status: "start" });
    try {
        const text = await getScript(key, url);
        if (!text || text.length === 0) {
            emitFailed(key, "script is empty");
            return;
        }
        try {
            const result = executeScript(text, appName);
            emitSuccess(key, url);
            return result;
        } catch (error: any) {
            if (error.message.includes("Can only have one anonymous define call per script file")) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const define = window.define;
                if ("function" == typeof define && define.amd) {
                    delete define.amd;
                }
                const result = executeScript(text, appName);
                emitSuccess(key, url);
                return result;
            }
            emitFailed(key, error.message);
        }
    } catch (error: any) {
        emitFailed(key, error.message);
    }
};


async function fetchWithTimeout(resource: string, options: RequestInit & { timeout: number }) {
    const { timeout = 10000 } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource, {
        ...options,
        signal: controller.signal,
        headers: {
            "content-type": "text/plain",
        },
    });
    clearTimeout(id);

    return response;
}
