import type { AppManager } from "./AppManager";
import type { PageState } from "./Page";

import { internalEmitter } from "./InternalEmitter";
import { callbacks } from "./callback";

export class PageStateImpl {
    constructor(private manager: AppManager) {
        internalEmitter.on("changePageState", () => {
            callbacks.emit("pageStateChange", this.toObject());
        });
    }

    public get index(): number {
        return this.manager.store.getMainViewSceneIndex() || 0;
    }

    public get length(): number {
        return this.manager.mainViewScenesLength || 0;
    }

    public toObject(): PageState {
        const index = this.index >= this.length ? this.length - 1 : this.index;
        return {
            index,
            length: this.length,
        };
    }
}
