import Emittery from "emittery";
import { loadApp } from "./loader";
import type { NetlessApp, RegisterEvents, RegisterParams } from "../typings";

export type LoadAppEvent = {
    kind: string;
    status: "start" | "success" | "failed";
    reason?: string;
};

export type SyncRegisterAppPayload =  { kind: string, src: string, name: string | undefined };
export type SyncRegisterApp = (payload: SyncRegisterAppPayload) => void;

class AppRegister {
    public kindEmitters: Map<string, Emittery<RegisterEvents>> = new Map();
    public registered: Map<string, RegisterParams> = new Map();
    public appClassesCache: Map<string, Promise<NetlessApp>> = new Map();
    public appClasses: Map<string, () => Promise<NetlessApp>> = new Map();

    private syncRegisterApp: SyncRegisterApp | null = null;

    public setSyncRegisterApp(fn: SyncRegisterApp) {
        this.syncRegisterApp = fn;
    }

    public onSyncRegisterAppChange = (payload: SyncRegisterAppPayload) => {
        this.register({ kind: payload.kind, src: payload.src });
    }

    public async register(params: RegisterParams): Promise<void> {
        this.appClassesCache.delete(params.kind);
        this.registered.set(params.kind, params);

        const paramSrc = params.src;
        let downloadApp: () => Promise<NetlessApp>;

        if (typeof paramSrc === "string") {
            downloadApp = async () => {
                const result = await loadApp(paramSrc, params.kind, params.name) as any;
                if (result.__esModule) {
                    return result.default;
                }
                return result;
            };
            if (this.syncRegisterApp) {
                this.syncRegisterApp({ kind: params.kind, src: paramSrc, name: params.name });
            }
        }
        if (typeof paramSrc === "function") {
            downloadApp = async () => {
                let appClass = await paramSrc() as any;
                if (appClass) {
                    if (appClass.__esModule || appClass.default) {
                        appClass = appClass.default;
                    }
                    return appClass;
                } else {
                    throw new Error(
                        `[WindowManager]: load remote script failed, ${paramSrc}`
                    );
                }
            };
        }
        if (typeof paramSrc === "object") {
            downloadApp = async () => paramSrc;
        }
        this.appClasses.set(params.kind, async () => {
            let app = this.appClassesCache.get(params.kind);
            if (!app) {
                app = downloadApp();
                this.appClassesCache.set(params.kind, app);
            }
            return app;
        });

        if (params.addHooks) {
            const emitter = this.createKindEmitter(params.kind);
            if (emitter) {
                params.addHooks(emitter);
            }
        }
    }

    public unregister(kind: string) {
        this.appClasses.delete(kind);
        this.appClassesCache.delete(kind);
        this.registered.delete(kind);
        const kindEmitter = this.kindEmitters.get(kind);
        if (kindEmitter) {
            kindEmitter.clearListeners();
            this.kindEmitters.delete(kind);
        }
    }

    public async notifyApp<T extends keyof RegisterEvents>(
        kind: string,
        event: T,
        payload: RegisterEvents[T]
    ) {
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
