import { Storage } from "@netless/synced-store";
import { Val } from "value-enhancer";
import type { AppManager } from "./AppManager";

export type ScrollStorageState = { scrollTop: number }
export type ScrollStorage = Storage<ScrollStorageState>;

export const createScrollStorage = (manager: AppManager) => {
    return new Storage<ScrollStorageState>({
        plugin$: new Val(manager.windowManger),
        isWritable$: manager.isWritable$,
        namespace: "scrollStorage",
        defaultState: { scrollTop: 0 }
    });
};
