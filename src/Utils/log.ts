import { WindowManager } from "../index";

export const log = (...args: any[]): void => {
    if (WindowManager.debug) {
        console.log(`[WindowManager]:`, ...args);
    }
};
