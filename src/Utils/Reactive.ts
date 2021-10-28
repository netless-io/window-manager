import { listenUpdated, unlistenUpdated, reaction, UpdateEventKind } from "white-web-sdk";
import type { AkkoObjectUpdatedProperty } from "white-web-sdk";

export const onObjectInserted = (object: any, func: () => void) => { // 兼容老版本的 reaction
    if (object === undefined) return;
    if (listenUpdated) {
        const listener = (events: readonly AkkoObjectUpdatedProperty<any>[]) => {
            const kinds = events.map(e => e.kind);
            if (kinds.includes(UpdateEventKind.Inserted)) {
                func();
            }
        }
        listenUpdated(object, listener);
        func();
        return () => unlistenUpdated(object, listener);
    } else {
        return reaction(
            () => object,
            () => {
                func();
            }, {
                fireImmediately: true,
            }
        )
    }
}

export const onObjectRemoved = (object: any, func: () => void) => {
    if (object === undefined) return;
    if (listenUpdated) {
        const listener = (events: readonly AkkoObjectUpdatedProperty<any>[]) => {
            const kinds = events.map(e => e.kind);
            if (kinds.includes(UpdateEventKind.Removed)) {
                func();
            }
        }
        listenUpdated(object, listener);
        func();
        return () => unlistenUpdated(object, listener);
    } else {
        return reaction(
            () => object,
            () => {
                func();
            }, {
                fireImmediately: true,
            }
        )
    }
}
