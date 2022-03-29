import type { Displayer, ScenesCallbacksNode, View } from "white-web-sdk";
import type { PageState } from "../Page";

export type AppPageStateParams = {
    displayer: Displayer;
    scenePath: string | undefined;
    view: View | undefined;
    notifyPageStateChange: () => void;
};

export class AppPageStateImpl {
    private sceneNode: ScenesCallbacksNode | null = null;

    constructor(private params: AppPageStateParams) {
        const { displayer, scenePath } = this.params;
        if (scenePath) {
            this.sceneNode = displayer.createScenesCallback(scenePath, {
                onAddScene: this.onSceneChange,
                onRemoveScene: this.onSceneChange,
            });
        }
    }

    private onSceneChange = (node: ScenesCallbacksNode) => {
        this.sceneNode = node;
        this.params.notifyPageStateChange();
    };

    public getFullPath(index: number) {
        const scenes = this.sceneNode?.scenes;
        if (this.params.scenePath && scenes) {
            const name = scenes[index];
            if (name) {
                return `${this.params.scenePath}/${name}`;
            }
        }
    }

    public toObject(): PageState {
        return {
            index: this.params.view?.focusSceneIndex || 0,
            length: this.sceneNode?.scenes.length || 0,
        };
    }

    public destroy() {
        this.sceneNode?.dispose();
    }
}
