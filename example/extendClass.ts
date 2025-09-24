import { AppContext, AppManager, BoxManager, AppProxy, WindowManager, BaseInsertParams, AttributesDelegate, CursorManager, CursorOptions, ApplianceIcons } from "../dist";

export class customAppContext extends AppContext {
    constructor(manager: AppManager, boxManager: BoxManager, appId: string, appProxy: AppProxy, appOptions?: any) {
        super(manager, boxManager, appId, appProxy, appOptions);
    }
    public customMethod() {
        console.log("customAppContext customMethod");
    }
}

export class customAppManager extends AppManager {
    constructor(manager: WindowManager) {
        super(manager);
    }
    public customMethod() {
        console.log("customAppManager customMethod");
    }
}

export class customAppProxy extends AppProxy {
    constructor(params: BaseInsertParams, manager: AppManager, appId: string, isAddApp: boolean) {
        super(params, manager, appId, isAddApp);
    }
    public customMethod() {
        console.log("customAppProxy customMethod");
    }
}

export class customBoxManager extends BoxManager {
    constructor(context: any, createTeleBoxManagerConfig?: any | undefined) {
        super(context, createTeleBoxManagerConfig);
    }
    public customMethod() {
        console.log("customBoxManager customMethod");
    }
}

export class customAttributesDelegate extends AttributesDelegate {
    constructor(context: any) {
        super(context);
    }
    public customMethod() {
        console.log("customAttributesDelegate customMethod");
    }
}

export class customCursorManager extends CursorManager {
    constructor(manager: AppManager, enableCursor: boolean, cursorOptions?: CursorOptions, applianceIcons?: ApplianceIcons) {
        super(manager, enableCursor, cursorOptions, applianceIcons);
    }
    public customMethod() {
        console.log("customCursorManager customMethod");
    }
}