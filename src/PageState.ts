import type { AppManager } from "./AppManager";
import { callbacks } from "./callback";
import { emitter } from "./InternalEmitter";

export type PageState = {
    index: number;
    length: number;
}

export class PageStateImpl {
    constructor(private manager: AppManager) {
        emitter.on("changePageState", () => {
            callbacks.emit("pageStateChange", this.toObject())
        });
    };

    public get index(): number {
        return this.manager?.store.getMainViewSceneIndex() || 0;
    }

    public get length(): number {
        return this.manager?.mainViewScenesLength || 0;
    }

    public toObject(): PageState {
        return {
            index: this.index,
            length: this.length
        }
    }
}
