import type { WindowManager } from ".";
import Emittery from "emittery";
import type { EmitterType } from "./InternalEmitter";
import { appRegister } from "./Register";

export interface ExtendContext {
    readonly manager: ExtendPluginManager;
    readonly windowManager: WindowManager;
    readonly internalEmitter: EmitterType;
    windowManagerContainer?: HTMLElement;
}

export abstract class ExtendPlugin extends Emittery {
    context!: ExtendContext;
    abstract readonly kind: string;
    protected _inject(context: ExtendContext) {
        this.context = context;
    }
    abstract onCreate(): void;
    abstract onDestroy(): void;
}

export type ExtendPluginInstance<T extends ExtendPlugin> = T;

export interface ExtendManagerOptions {
    readonly windowManager: WindowManager;
    readonly internalEmitter: EmitterType;
    readonly container?: HTMLElement;
}

export class ExtendPluginManager {
    private extends: Map<string, ExtendPluginInstance<any>> = new Map();
    private context: ExtendContext;
    constructor(props: ExtendManagerOptions) {
        this.context = {
            manager: this,
            windowManager: props.windowManager,
            internalEmitter: props.internalEmitter,
        };
        if (props.container) {
            this.refreshContainer(props.container);
        }
    }

    refreshContainer(container: HTMLElement) {
        this.context.windowManagerContainer = container;
        this.extends.forEach(extend => {
            extend._inject(this.context);
        });
    }

    hasRegister(kind: string) {
        return appRegister.appClasses.has(kind);
    }

    use(extend: ExtendPluginInstance<any>) {
        this.extends.set(extend.kind, extend);
        extend._inject(this.context);
        extend.onCreate();
    }
    destroy() {
        this.extends.forEach(extend => {
            this.extends.delete(extend.kind);
            extend.onDestroy();
        });
    }
}
