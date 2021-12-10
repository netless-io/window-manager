import { AppCreateError, ParamsInvalidError } from "../Utils/error";
import { AppProxy } from "./index";
import { appRegister } from "../Register";
import { genAppId } from "../Utils/Common";
import type { AddAppParams } from "../index";
import type { AppManager } from "../AppManager";
import { AppStatus } from "../constants";

export type CreatorParams = AddAppParams & {
    isAddApp: boolean;
    isDynamicPPT: boolean;
};

export const initCreator = (appManager: AppManager) => {
    new Creator(appManager);
};

export class Creator {
    private static instance: Creator;

    constructor(private appManager: AppManager) {
        Creator.instance = this;
    }

    public static async create(params: CreatorParams) {
        const instance = Creator.instance;
        if (params.isAddApp) {
            Creator.instance.validate(params);
        }
        instance.appManager.appStatus.set(params.kind, AppStatus.StartCreate);
        const appId = await instance.before(params);
        await instance.exec(params, appId);
        instance.after();
        return appId;
    }

    public static async createByAppId(params: CreatorParams, appId: string) {
        const instance = Creator.instance;
        await instance.exec(params, appId);
    }

    private async validate(params: CreatorParams) {
        if (!params.kind || typeof params.kind !== "string") {
            throw new ParamsInvalidError();
        }
        const appImpl = await appRegister.appClasses.get(params.kind)?.();
        if (appImpl && appImpl.config?.singleton) {
            if (this.appManager.appProxies.has(params.kind)) {
                throw new AppCreateError();
            }
        }
    }

    private async before(params: CreatorParams) {
        const appId = await genAppId(params.kind);
        const attrs = params.attributes ?? {};
        this.initAppAttributes(appId, attrs);
        this.appManager.store.setupAppAttributes(params, appId, params.isDynamicPPT);
        this.appManager.updateFocusApp(appId);
        return appId;
    }

    private async exec(params: CreatorParams, appId: string) {
        const appProxyContext = this.appManager.createAppProxyContext();
        const appProxy = new AppProxy(
            params,
            appProxyContext,
            this.appManager.boxManager,
            appId,
            params.isAddApp
        );
        if (appProxy) {
            await appProxy.baseInsertApp();
            return appProxy;
        } else {
            throw new Error("[WindowManger]: initialize AppProxy failed");
        }
    }

    private after() {
        this.appManager.setBoxToNormal();
    }

    private initAppAttributes(appId: string, attrs: any) {
        this.appManager.safeUpdateAttributes([appId], attrs);
    }
}
