import Emittery from "emittery";
import { WindowManager } from "../index";
import type { NetlessApp, RegisterEvents, RegisterParams } from "../typings";

export type NotifyAppPayload = {
    appId: string,
    instance: NetlessApp
}

class AppRegister {
    public kindEmitters: Map<string, Emittery<RegisterEvents>> = new Map();

    constructor() {}
    
    public register(params: RegisterParams) {
        if (typeof params.src === "string") {
            // TODO 远程加载 APP
        } else {
            WindowManager.appClasses.set(params.kind, params.src);
        }
        if (params.setup) {
            const emitter = this.createKindEmitter(params.kind);
            params.setup({ emitter });
        }
    }

    public async notifyApp(kind: string, event: keyof RegisterEvents,  payload: NotifyAppPayload) {
        const emitter = this.kindEmitters.get(kind);
        await emitter?.emit(event, payload);
    }

    private createKindEmitter(kind: string) {
        if (!this.kindEmitters.has(kind)) {
            const emitter = new Emittery<RegisterEvents>();
            this.kindEmitters.set(kind, emitter);
        }
        return this.kindEmitters.get(kind)!;
    }
}

export const appRegister = new AppRegister();
