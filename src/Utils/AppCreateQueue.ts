import { callbacks } from "../callback";
import { SETUP_APP_DELAY } from "../constants";

export type Invoker<T = any> = () => Promise<T | undefined>;

export class AppCreateQueue {
    private list: Invoker[] = [];
    private currentInvoker: Invoker | undefined;
    private timer: number | undefined;
    private idlePromise?: Promise<void>;
    private resolveIdle?: () => void;
    public isEmit = false;

    private initInterval() {
        return setInterval(() => {
            this.invoke();
        }, 50);
    }

    public push<T>(item: Invoker<T>) {
        this.list.push(item);
        this.invoke();
        if (this.timer === undefined && this.list.length > 0) {
            this.timer = this.initInterval();
        }
    }

    public invoke() {
        if (this.list.length === 0) {
            return;
        }
        if (this.currentInvoker !== undefined) {
            return;
        }

        const item = this.list.shift();
        if (item) {
            this.currentInvoker = item;
            item()
                .then(() => {
                    this.invoked();
                })
                .catch(error => {
                    console.error(`[WindowManager]: create app error: ${error.message}`);
                    this.invoked();
                });
        }
    }

    private invoked = () => {
        this.currentInvoker = undefined;
        if (this.list.length === 0) {
            this.clear();
            this.resolveIdle?.();
            this.resolveIdle = undefined;
            this.idlePromise = undefined;
            this.emitReady();
        }
    };

    /** Resolve when all AppProxy/TeleBox creation tasks queued so far finish. */
    public whenIdle(): Promise<void> {
        if (this.currentInvoker === undefined && this.list.length === 0) {
            return Promise.resolve();
        }
        if (!this.idlePromise) {
            this.idlePromise = new Promise(resolve => {
                this.resolveIdle = resolve;
            });
        }
        return this.idlePromise;
    }

    private clear = () => {
        clearInterval(this.timer);
        this.timer = undefined;
    };

    public emitReady() {
        if (!this.isEmit) {
            setTimeout(() => {
                callbacks.emit("ready");
            }, SETUP_APP_DELAY);
        }
        this.isEmit = true;
    }

    public empty() {
        this.list = [];
        this.clear();
        if (this.currentInvoker === undefined) {
            this.resolveIdle?.();
            this.resolveIdle = undefined;
            this.idlePromise = undefined;
        }
    }

    public destroy() {
        if (this.timer) {
            this.clear();
        }
        this.resolveIdle?.();
        this.resolveIdle = undefined;
        this.idlePromise = undefined;
    }
}
