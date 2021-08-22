import { AddAppParams, AppManager, AppSyncAttributes } from "./index";
import { get, pick } from "lodash-es";
import { AppAttributes } from "./constants";
import { setViewFocusScenePath } from "./Common";


export enum Fields {
    Apps = "apps",
    Focus = "focus",
    State = "state",
    BoxState = "boxState",
}
export class AttributesDelegate {
    constructor(
        private manager: AppManager
    ) {}

    public apps() {
        return get(this.manager.attributes, [Fields.Apps]);
    }

    public get focus() {
        return get(this.manager.attributes, [Fields.Focus]);
    }

    public getAppAttributes(id: string): AppSyncAttributes {
        return get(this.apps(), [id]);
    }

    public getAppState(id: string) {
        return get(this.apps(), [id, Fields.State]);
    }

    public setupAppAttributes(params: AddAppParams, id: string, isDynamicPPT: boolean) {
        const attributes = this.manager.attributes;
        if (!attributes.apps) {
            this.manager.safeSetAttributes({ apps: {} });
        }
        const attrNames = ["scenePath", "title"];
        if (!isDynamicPPT) {
            attrNames.push("scenes");
        }
        const options = pick(params.options, attrNames);
        let attrs: AppSyncAttributes = { kind: params.kind, options, isDynamicPPT };
        if (typeof params.src === "string") {
            attrs.src = params.src;
        }
        this.manager.safeUpdateAttributes([Fields.Apps, id], attrs);
        this.manager.safeUpdateAttributes([Fields.Apps, id, Fields.State],{
            [AppAttributes.Size]: {},
            [AppAttributes.Position]: {},
            [AppAttributes.SnapshotRect]: {},
            [AppAttributes.SceneIndex]: 0
        });
        this.manager.safeSetAttributes({ [Fields.Focus]: id });
    }

    public updateAppState(appId: string, stateName: AppAttributes, state: any) {
        this.manager.safeUpdateAttributes([Fields.Apps, appId, Fields.State, stateName], state);
    }

    public cleanAppAttributes(id: string) {
        this.manager.safeUpdateAttributes([Fields.Apps, id], undefined);
        this.manager.safeSetAttributes({ [id]: undefined });
        const focus = this.manager.attributes[Fields.Focus];
        if (focus === id) {
            this.cleanFocus();
        }
    }

    public cleanFocus() {
        this.manager.safeSetAttributes({ [Fields.Focus]: undefined });
    }

    public cleanAttributes() {
        this.manager.safeSetAttributes({
            [Fields.Apps]: undefined,
            [Fields.BoxState]: undefined,
            [Fields.Focus]: undefined,
            _mainScenePath: undefined,
            _mainSceneIndex: undefined,
        });
    }

    public getAppSceneIndex(id: string) {
        return this.getAppState(id)?.[AppAttributes.SceneIndex];
    }

    public getMainViewScenePath() {
        return this.manager.attributes["_mainScenePath"];
    }

    public getMainViewSceneIndex() {
        return this.manager.attributes["_mainSceneIndex"];
    }

    public getBoxState() {
        return this.manager.attributes[Fields.BoxState];
    }

    public setMainViewScenePath(scenePath: string) {
        this.manager.safeSetAttributes({ _mainScenePath: scenePath });
    }

    public setMainViewSceneIndex(index: number) {
        this.manager.safeSetAttributes({ _mainSceneIndex: index });
    }

    // TODO 状态中保存一个 SceneName 优化性能
    public setMainViewFocusPath() {
        const scenePath = this.getMainViewScenePath();
        const sceneIndex = this.getMainViewSceneIndex();
        if (scenePath && sceneIndex !== undefined) {
            const scenes = this.manager.displayer.entireScenes()[scenePath];
            if (scenes) {
                const sceneName = scenes[sceneIndex].name;
                setViewFocusScenePath(this.manager.mainView, `${scenePath}/${sceneName}`);
            }
        }
    }
}
