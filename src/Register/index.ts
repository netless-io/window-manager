import Emittery from "emittery";
import type { NetlessApp, RegisterEvents, RegisterParams } from "../typings";
import { loadApp } from "./loader";

export type NotifyAppPayload = {
    appId: string;
    instance: NetlessApp;
};

class AppRegister {
    public kindEmitters: Map<string, Emittery<RegisterEvents>> = new Map();
    public registered: Map<string, RegisterParams> = new Map();
    public appClasses: Map<string, NetlessApp> = new Map();

    public async register(params: RegisterParams) {
        this.registered.set(params.kind, params);
        if (typeof params.src === "string") {
            const url = params.src;
            const appClass = await loadApp(url, params.kind);
            if (appClass) {
                this.appClasses.set(params.kind, appClass);
            } else {
                throw new Error(`[WindowManager]: load remote script failed, ${url}`);
            }
        } else {
            this.appClasses.set(params.kind, params.src);
        }
        if (params.setup) {
            const emitter = this.createKindEmitter(params.kind);
            if (emitter) {
                params.setup({ emitter });
            }
        }
    }

    public async notifyApp(kind: string, event: keyof RegisterEvents, payload: NotifyAppPayload) {
        const emitter = this.kindEmitters.get(kind);
        await emitter?.emit(event, payload);
    }

    private createKindEmitter(kind: string) {
        if (!this.kindEmitters.has(kind)) {
            const emitter = new Emittery<RegisterEvents>();
            this.kindEmitters.set(kind, emitter);
        }
        return this.kindEmitters.get(kind);
    }
}

export const appRegister = new AppRegister();
