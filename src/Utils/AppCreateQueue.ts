import { callbacks } from "../callback";
import { SETUP_APP_DELAY } from "../constants";

export type Invoker<T = any> = () => Promise<T | undefined>;

export class AppCreateQueue {
    private list: Invoker[] = [];
    private currentInvoker: Invoker | undefined;
    private timer: number | undefined;
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
            this.emitReady();
        }
    };

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
    }

    public destroy() {
        if (this.timer) {
            this.clear();
        }
    }
}
