import { AddAppParams, AppManager, AppSyncAttributes } from "./index";
import get from "lodash.get";
import { AppAttributes } from "./constants";


export enum Fields {
    Apps = "apps",
    Focus = "focus",
    State = "state"
}
export class AttributesDelegate {
    constructor(
        private manager: AppManager
    ) {}

    public get apps() {
        return get(this.manager.attributes, [Fields.Apps]);
    }

    public get focus() {
        return get(this.manager.attributes, [Fields.Focus]);
    }

    public getAppAttributes(id: string) {
        return get(this.apps, [id]);
    }

    public getAppState(id: string) {
        return get(this.apps, [id, Fields.State]);
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
        this.manager.safeUpdateAttributes([Fields.Apps, id], attrs);
        this.manager.safeUpdateAttributes([Fields.Apps, id, Fields.State],{
            [AppAttributes.Size]: { width: 0, height: 0 },
            [AppAttributes.Position]: { x: 0, y: 0 },
            [AppAttributes.SnapshotRect]: {},
        });
        this.manager.safeSetAttributes({ [Fields.Focus]: id });
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
}
