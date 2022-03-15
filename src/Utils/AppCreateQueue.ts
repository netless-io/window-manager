import { callbacks } from "../callback";
import type { AppProxy } from "../AppProxy";

export type Invoker = () => Promise<AppProxy | undefined>;

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

    public push(item: Invoker) {
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
    }

    private clear = () => {
        clearInterval(this.timer);
        this.timer = undefined;
    }

    public emitReady() {
        if (!this.isEmit) {
            callbacks.emit("ready");
        }
        this.isEmit = true;
    }

    public destroy() {
        if (this.timer) {
            this.clear();
        }
    }
}
