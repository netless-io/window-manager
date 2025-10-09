import { AppContext, AppProxy } from "../App";
import { AppManager } from "../AppManager";
import { AttributesDelegate } from "../AttributesDelegate";
import { BoxManager } from "../BoxManager";
import { CursorManager } from "../Cursor";
import { TeleBoxManager, TeleBoxCollector } from "@netless/telebox-insider";

export { AppManager } from "../AppManager";
export { AppContext, AppProxy } from "../App";
export { BoxManager } from "../BoxManager";
export { AttributesDelegate } from "../AttributesDelegate";
export { CursorManager } from "../Cursor";
export { TeleBoxManager, TeleBoxCollector } from "@netless/telebox-insider";

export type ExtendClassAble =
    | typeof AppManager
    | typeof AppProxy
    | typeof AppContext
    | typeof BoxManager
    | typeof AttributesDelegate
    | typeof CursorManager
    | typeof TeleBoxManager
    | typeof TeleBoxCollector;

export type ExtendClass = {
    AppManager?: typeof AppManager;
    BoxManager?: typeof BoxManager;
    AttributesDelegate?: typeof AttributesDelegate;
    CursorManager?: typeof CursorManager;
    AppProxy?: typeof AppProxy;
    AppContext?: typeof AppContext;
    TeleBoxManager?: typeof TeleBoxManager;
    TeleBoxCollector?: typeof TeleBoxCollector;
};
export function getExtendClass<T extends ExtendClassAble>(
    baseClass: T,
    extendClass?: ExtendClass
): T {
    if (baseClass.kind && extendClass && Object.keys(extendClass).includes(baseClass.kind)) {
        switch (baseClass.kind) {
            case "AppManager":
                return (extendClass?.AppManager || AppManager) as T;
            case "BoxManager":
                return (extendClass?.BoxManager || BoxManager) as T;
            case "AttributesDelegate":
                return (extendClass?.AttributesDelegate || AttributesDelegate) as T;
            case "CursorManager":
                return (extendClass?.CursorManager || CursorManager) as T;
            case "AppProxy":
                return (extendClass?.AppProxy || AppProxy) as T;
            case "AppContext":
                return (extendClass?.AppContext || AppContext) as T;
            case "TeleBoxManager":
                return (extendClass?.TeleBoxManager || TeleBoxManager) as T;
            case "TeleBoxCollector":
                return (extendClass?.TeleBoxCollector || TeleBoxCollector) as T;
            default:
                return baseClass;
        }
    }
    return baseClass;
}
