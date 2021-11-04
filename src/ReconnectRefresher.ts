import { isFunction } from 'lodash';
import { RoomPhase } from 'white-web-sdk';
import type { Room } from "white-web-sdk";
import type { AppManager } from './AppManager';
import { log } from './Utils/log';

// 白板重连之后会刷新所有的对象，导致 listener 失效, 所以这里在重连之后重新对所有对象进行监听
export class ReconnectRefresher {
    private phase?: RoomPhase;
    private room: Room | undefined;
    private reactors: Map<string, any> = new Map();
    private disposers: Map<string, any> = new Map();

    constructor(room: Room | undefined, private manager: AppManager) {
        this.room = room;
        this.phase = room?.phase;
        room?.callbacks.on("onPhaseChanged", this.onPhaseChanged);
    }

    private onPhaseChanged = (phase: RoomPhase) => {
        if (phase === RoomPhase.Connected && this.phase === RoomPhase.Reconnecting) {
            this.onReconnected();
        }
        this.phase = phase;
    }

    private onReconnected = () => {
        log("onReconnected refresh reactors");
        this.releaseDisposers();
        this.reactors.forEach((func, id) => {
            if (isFunction(func)) {
                this.disposers.set(id, func());
            }
        });
        this.manager.notifyReconnected();
    }

    private releaseDisposers() {
        this.disposers.forEach(disposer => {
            if (isFunction(disposer)) {
                disposer();
            }
        })
        this.disposers.clear();
    }

    public add(id: string, func: any) {
        if (isFunction(func)) {
            this.reactors.set(id, func);
            this.disposers.set(id, func());
        }
    }

    public remove(id: string) {
        if (this.reactors.has(id)) {
            this.reactors.delete(id);
        }
        const disposer = this.disposers.get(id);
        if (disposer) {
            if (isFunction(disposer)) {
                disposer();
            }
            this.disposers.delete(id);
        }
    }

    public destroy() {
        this.room?.callbacks.off("onPhaseChanged", this.onPhaseChanged);
        this.releaseDisposers();
    }
}
