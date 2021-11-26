import { listenUpdated, unlistenUpdated, reaction, UpdateEventKind } from "white-web-sdk";
import type { AkkoObjectUpdatedProperty , AkkoObjectUpdatedListener } from "white-web-sdk";

// 兼容 13 和 14 版本 SDK
export const onObjectByEvent = (event: UpdateEventKind) => {
    return (object: any, func: () => void) => {
        if (object === undefined) return;
        if (listenUpdated) {
            const listener = (events: readonly AkkoObjectUpdatedProperty<any>[]) => {
                const kinds = events.map(e => e.kind);
                if (kinds.includes(event)) {
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
}

export const safeListenPropsUpdated = <T>(
    getProps: () => T,
    callback: AkkoObjectUpdatedListener<T>
  ) => {
    let disposeListenUpdated: (() => void) | null = null;
    const disposeReaction = reaction(
      getProps,
      () => {
        if (disposeListenUpdated) {
          disposeListenUpdated();
          disposeListenUpdated = null;
        }
        const props = getProps();
        disposeListenUpdated = () => unlistenUpdated(props, callback);
        listenUpdated(props, callback);
      },
      { fireImmediately: true }
    );

    return () => {
      disposeListenUpdated?.();
      disposeReaction();
    };
}

export const onObjectRemoved = onObjectByEvent(UpdateEventKind.Removed);
export const onObjectInserted = onObjectByEvent(UpdateEventKind.Inserted);
