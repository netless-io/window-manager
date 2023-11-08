import { callbacks } from "./callback";
import { internalEmitter } from "./InternalEmitter";
import type { View } from "white-web-sdk";
import type { AppProxy } from "./App";

export type RedoUndoContext = {
    mainView: () => View;
    focus: () => string | undefined;
    getAppProxy: (id: string) => AppProxy | undefined;
};

export class RedoUndo {
    constructor(private context: RedoUndoContext) {
        internalEmitter.on("focusedChange", changed => {
            this.disposePrevFocusViewRedoUndoListeners(changed.prev);
            setTimeout(() => {
                this.addRedoUndoListeners(changed.focused);
            }, 0);
        });
        internalEmitter.on("rootDirRemoved", () => {
            this.disposePrevFocusViewRedoUndoListeners(context.focus());
            this.addRedoUndoListeners(context.focus());
        });
        this.addRedoUndoListeners(context.focus());
    }

    private addRedoUndoListeners = (focused: string | undefined) => {
        if (focused === undefined) {
            this.addViewCallbacks(
                this.context.mainView(),
                this.onCanRedoStepsUpdate,
                this.onCanUndoStepsUpdate
            );
        } else {
            const focusApp = this.context.getAppProxy(focused);
            if (focusApp && focusApp.view) {
                this.addViewCallbacks(
                    focusApp.view,
                    this.onCanRedoStepsUpdate,
                    this.onCanUndoStepsUpdate
                );
            }
        }
    };

    private addViewCallbacks = (
        view: View,
        redoListener: (steps: number) => void,
        undoListener: (steps: number) => void
    ) => {
        redoListener(view.canRedoSteps);
        undoListener(view.canUndoSteps);
        view.callbacks.on("onCanRedoStepsUpdate", redoListener);
        view.callbacks.on("onCanUndoStepsUpdate", undoListener);
    };

    private disposeViewCallbacks = (view: View) => {
        view.callbacks.off("onCanRedoStepsUpdate", this.onCanRedoStepsUpdate);
        view.callbacks.off("onCanUndoStepsUpdate", this.onCanUndoStepsUpdate);
    };

    private onCanRedoStepsUpdate = (steps: number) => {
        callbacks.emit("canRedoStepsChange", steps);
    };

    private onCanUndoStepsUpdate = (steps: number) => {
        callbacks.emit("canUndoStepsChange", steps);
    };

    private disposePrevFocusViewRedoUndoListeners = (prevFocused: string | undefined) => {
        let view: View | undefined = undefined;
        if (prevFocused === undefined) {
            view = this.context.mainView();
        } else {
            const appProxy = this.context.getAppProxy(prevFocused);
            if (appProxy && appProxy.view) {
                view = appProxy.view;
            }
        }
        if (view) {
            this.disposeViewCallbacks(view);
        }
    };

    public destroy() {
        this.disposePrevFocusViewRedoUndoListeners(this.context.focus());
    }
}
