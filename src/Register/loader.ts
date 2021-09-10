import { getItem, setItem } from "./storage";
import type { NetlessApp } from "../typings";

const Prefix = "NetlessApp";

const TIMEOUT = 10000; // 10 秒超时

export const getScript = async (url: string): Promise<string> => {
    const item = await getItem(url);
    if (item) {
        return item;
    } else {
        const result = await fetchWithTimeout(url, { timeout: TIMEOUT });
        const text = await result.text();
        await setItem(url, text);
        return text;
    }
};

export const executeScript = (text: string, appName: string): NetlessApp => {
    let result = Function(text + `;return ${appName}`)();
    if (typeof result === "undefined") {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result = window[appName];
    }
    return result;
};

export const loadApp = async (
    url: string,
    key: string,
    name?: string
): Promise<NetlessApp | undefined> => {
    const appName = name || Prefix + key;
    const text = await getScript(url);
    try {
        return executeScript(text, appName);
    } catch (error: any) {
        if (error.message.includes("Can only have one anonymous define call per script file")) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const define = window.define;
            if ("function" == typeof define && define.amd) {
                delete define.amd;
            }
            return executeScript(text, appName);
        }
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
