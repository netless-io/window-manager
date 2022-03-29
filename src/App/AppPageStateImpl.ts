import { get } from "lodash";
import type { Displayer, SceneDefinition, ScenesCallbacksNode, View } from "white-web-sdk";
import type { SceneMap, PageState } from "../Page";

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

    public get scenes(): SceneDefinition[] | undefined {
        return Object.values(this.getSceneMap());
    }

    public getFullPath(index: number) {
        const scenes = this.scenes;
        if (this.params.scenePath && scenes) {
            const name = scenes[index]?.name;
            if (name) {
                return `${this.params.scenePath}/${name}`;
            }
        }
    }

    private getSceneMap() {
        // TODO 使用了 SDK 没有暴露的类型的值, 需要确认
        return get(this.sceneNode, ["state", "group", "scenesMap"]) as SceneMap;
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
