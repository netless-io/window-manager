import { callbacks } from "../callback";
import { getItem, setItem } from "./storage";
import type { NetlessApp } from "../typings";

const Prefix = "NetlessApp";

const TIMEOUT = 10000; // 下载 script 10 秒超时

export const getScript = async (url: string): Promise<string> => {
    const item = await getItem(url);
    if (item) {
        return item.sourceCode;
    } else {
        const result = await fetchWithTimeout(url, { timeout: TIMEOUT });
        const text = await result.text();
        await setItem(url, text);
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

export const loadApp = async (url: string, key: string, name?: string): Promise<NetlessApp> => {
    const appName = name || Prefix + key;
    callbacks.emit("loadApp", { kind: key, status: "start" });

    let text: string;
    try {
        text = await getScript(url);
        if (!text || text.length === 0) {
            callbacks.emit("loadApp", { kind: key, status: "failed", reason: "script is empty." });
            throw new Error("[WindowManager]: script is empty.");
        }
    } catch (error) {
        callbacks.emit("loadApp", { kind: key, status: "failed", reason: error.message });
        throw error;
    }
    return getResult(text, appName, key);
};

const getResult = (text: string, appName: string, key: string): NetlessApp => {
    try {
        const result = executeScript(text, appName);
        callbacks.emit("loadApp", { kind: key, status: "success" });
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
            callbacks.emit("loadApp", { kind: key, status: "success" });
            return result;
        }
        callbacks.emit("loadApp", { kind: key, status: "failed", reason: error.message });
        throw error;
    }
}

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
