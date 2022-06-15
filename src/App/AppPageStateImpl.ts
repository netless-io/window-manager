import type { Displayer, ScenesCallbacksNode, View } from "white-web-sdk";
import type { PageState } from "../Page";

export type AppPageStateParams = {
    displayer: Displayer;
    scenePath: string | undefined;
    view: View | undefined;
    notifyPageStateChange: () => void;
};

export class AppPageStateImpl {
    public sceneNode: ScenesCallbacksNode | null = null;
    private scenePath?: string;
    private view?: View;

    constructor(private params: AppPageStateParams) {
        const { displayer, scenePath } = this.params;
        this.view = this.params.view;
        if (scenePath) {
            this.scenePath = scenePath;
            this.sceneNode = displayer.createScenesCallback(scenePath, {
                onAddScene: this.onSceneChange,
                onRemoveScene: this.onSceneChange,
            });
        }
    }

    public createSceneNode = (scenePath: string) => {
        this.scenePath = scenePath;
        if (this.sceneNode) {
            this.sceneNode.dispose();
        }
        this.sceneNode = this.params.displayer.createScenesCallback(scenePath, {
            onAddScene: this.onSceneChange,
            onRemoveScene: this.onSceneChange,
        });
        return this.sceneNode;
    }

    public setView(view: View) {
        this.view = view;
    }

    private onSceneChange = () => {
        this.params.notifyPageStateChange();
    };

    public getFullPath(index: number) {
        const scenes = this.sceneNode?.scenes;
        if (this.scenePath && scenes) {
            const name = scenes[index];
            if (name) {
                return `${this.scenePath}/${name}`;
            }
        }
    }

    public toObject(): PageState {
        return {
            index: this.view?.focusSceneIndex || 0,
            length: this.sceneNode?.scenes.length || 0,
        };
    }

    public destroy() {
        this.sceneNode?.dispose();
    }
}
