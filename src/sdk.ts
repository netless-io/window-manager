import { isBoolean } from 'lodash';
import { WhiteWebSdk } from 'white-web-sdk';
import { WindowManager } from './index';
import type { MountParams } from "./index";
import type { WhiteWebSdkConfiguration, JoinRoomParams } from "white-web-sdk";



type WhiteWindowSDKConfiguration = Omit<WhiteWebSdkConfiguration, "useMobXState">
type WindowJoinRoomParams = {
    joinRoomParams: Omit<JoinRoomParams, "useMultiViews" | "disableMagixEventDispatchLimit">,
    mountParams: Omit<MountParams, "room">,
}

export class WhiteWindowSDK {
    private sdk: WhiteWebSdk;

    constructor(params: WhiteWindowSDKConfiguration) {
        this.sdk = new WhiteWebSdk({ ...params, useMobXState: true });
    }

    public async mount(params: WindowJoinRoomParams): Promise<WindowManager> {
        const invisiblePlugins = params.joinRoomParams.invisiblePlugins || [];
        const room = await this.sdk.joinRoom({
            ...params.joinRoomParams,
            useMultiViews: true,
            invisiblePlugins: [...invisiblePlugins, WindowManager],
            disableMagixEventDispatchLimit: true,
        });
        const manager = await WindowManager.mount({
            room,
            ...params.mountParams
        });
        if (isBoolean(params.joinRoomParams.disableCameraTransform)) {
            manager.mainView.disableCameraTransform = params.joinRoomParams.disableCameraTransform;
        }
        return manager;
    }
}
