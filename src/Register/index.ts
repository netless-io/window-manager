import Emittery from "emittery";
import type { NetlessApp, RegisterEvents, RegisterParams } from "../typings";
import { loadApp } from "./loader";

class AppRegister {
    public kindEmitters: Map<string, Emittery<RegisterEvents>> = new Map();
    public registered: Map<string, RegisterParams> = new Map();
    public appClassesCache: Map<string, Promise<NetlessApp>> = new Map();
    public appClasses: Map<string, () => Promise<NetlessApp>> = new Map();

    public async register(params: RegisterParams): Promise<void> {
        this.registered.set(params.kind, params);
        
        const srcOrAppOrFunction = params.src
        let downloadApp: () => Promise<NetlessApp>
        
        if (typeof srcOrAppOrFunction === "string") {
            downloadApp = async () => {
                const appClass = await loadApp(srcOrAppOrFunction, params.kind);
                if (appClass) {
                    return appClass
                } else {
                    throw new Error(`[WindowManager]: load remote script failed, ${srcOrAppOrFunction}`);
                }
            }
        } else if (typeof srcOrAppOrFunction === "function") {
            downloadApp = srcOrAppOrFunction
        } else {
            downloadApp = async () => srcOrAppOrFunction
        }

        this.appClasses.set(params.kind, async () => {
            let app = this.appClassesCache.get(params.kind)
            if (!app) {
                app = downloadApp()
                this.appClassesCache.set(params.kind, app)
            }
            return app
        });
        
        if (params.addHooks) {
            const emitter = this.createKindEmitter(params.kind);
            if (emitter) {
                params.addHooks(emitter);
            }
        }
    }

    public async notifyApp<T extends keyof RegisterEvents>(kind: string, event: T, payload: RegisterEvents[T]) {
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
