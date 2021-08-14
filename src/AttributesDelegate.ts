import { AddAppParams, AppManager, AppSyncAttributes } from "./index";
import get from "lodash.get";
import { AppAttributes } from "./constants";

export class AttributesDelegate {
    constructor(
        private manager: AppManager
    ) {}

    public get apps() {
        return get(this.manager.attributes, ["apps"]);
    }

    public get focus() {
        return get(this.manager.attributes, ["focus"]);
    }

    public getAppAttributes(id: string) {
        return get(this.apps, [id]);
    }

    public getAppState(id: string) {
        return get(this.apps, [id, "state"]);
    }

    public setupAppAttributes(params: AddAppParams, id: string) {
        const attributes = this.manager.attributes;
        if (!attributes.apps) {
            this.manager.safeSetAttributes({ apps: {} });
        }
        let attrs: AppSyncAttributes = { kind: params.kind, options: params.options };
        if (typeof params.src === "string") {
            attrs.src = params.src;
        }
        this.manager.safeUpdateAttributes(["apps", id], attrs);
        this.manager.safeUpdateAttributes(["apps", id, "state"],{
            [AppAttributes.Size]: { width: 0, height: 0 },
            [AppAttributes.Position]: { x: 0, y: 0 },
            [AppAttributes.SnapshotRect]: {},
        });
        this.manager.safeSetAttributes({ focus: id });
    }

    public cleanAppAttributes(id: string) {
        this.manager.safeUpdateAttributes(["apps", id], undefined);
        this.manager.safeSetAttributes({ [id]: undefined });
        const focus = this.manager.attributes["focus"];
        if (focus === id) {
            this.manager.safeSetAttributes({ focus: undefined });
        }
    } 
}
