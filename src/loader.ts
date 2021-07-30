import { getItem, setItem } from "./storage";
import { Plugin } from "./index";

export const getScript = async (url: string, key: string) => {
    const item = await getItem(key);
    if (item) {
        return item;
    } else {
        const result = await fetch(url);
        const text = await result.text();
        await setItem(key, text);
        return text;
    }
}

export const executeScript = (text: string, name: string): Plugin => {
    let result = Function(text)();
    if (typeof result === "undefined") {
        // @ts-ignore
        result = window[name];  
    }
    return result;
}

export const loadPlugin = async (name: string, url: string) => {
    const text = await getScript(url, name);
    try {
        return executeScript(text, name);
    } catch (error) {
        if (error.message.includes("Can only have one anonymous define call per script file")) {
            // @ts-ignore
            const define = window.define;
            if("function" == typeof define && define.amd) {
                delete define.amd;
            }
            return executeScript(text, name);
        }
    }
}
