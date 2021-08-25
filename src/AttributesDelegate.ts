import { AddAppParams, AppManager, AppSyncAttributes } from "./index";
import { get, pick } from "lodash-es";
import { AppAttributes } from "./constants";
import { setViewFocusScenePath } from "./Common";
import { Camera, Size } from "white-web-sdk";


export enum Fields {
    Apps = "apps",
    Focus = "focus",
    State = "state",
    BoxState = "boxState",
    MainViewCamera = "mainViewCamera",
    MainViewSize = "mainViewSize",
    Broadcaster = "broadcaster"
}

type Apps = {
    [key: string]: AppSyncAttributes
}

export class AttributesDelegate {
    constructor(
        private manager: AppManager
    ) {}

    public apps(): Apps {
        return get(this.manager.attributes, [Fields.Apps]);
    }

    public get focus() {
        return get(this.manager.attributes, [Fields.Focus]);
    }

    public get broadcaster() {
        return get(this.manager.attributes, [Fields.Broadcaster]);
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
        if (get(this.manager.attributes, [Fields.Apps, appId, Fields.State])) {
            this.manager.safeUpdateAttributes([Fields.Apps, appId, Fields.State, stateName], state);
        }
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

    public getAppScenePath(id: string) {
        return this.getAppAttributes(id)?.options?.scenePath;
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

    public getMainViewCamera(): Camera {
        return get(this.manager.attributes, [Fields.MainViewCamera]);
    }

    public getMainViewSize(): Size {
        return get(this.manager.attributes, [Fields.MainViewSize]);
    }

    public setMainViewCamera(camera: Camera | undefined) {
        this.manager.safeSetAttributes({ [Fields.MainViewCamera]: { ...camera } });
    }

    public setMainViewSize(size: Size | undefined) {
        this.manager.safeSetAttributes({ [Fields.MainViewSize]: { ...size } });
    }

    public setBroadcaster(observerId: number | undefined) {
        this.manager.safeSetAttributes({ [Fields.Broadcaster]: observerId });
    }

    // TODO 状态中保存一个 SceneName 优化性能
    public setMainViewFocusPath() {
        const scenePath = this.getMainViewScenePath();
        if (scenePath) {
            setViewFocusScenePath(this.manager.mainView, scenePath);
        }
    }
}
