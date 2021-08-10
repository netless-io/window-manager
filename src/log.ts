import { WindowManager } from "./index";

export const log = (...args: any[]) => {
    if (WindowManager.debug) {
        console.log(`[Window Manager]:`, ...args);
    }
}
