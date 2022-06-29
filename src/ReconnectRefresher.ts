import { debounce, isFunction } from "lodash";
import { log } from "./Utils/log";
import { RoomPhase } from "white-web-sdk";
import type { Room } from "white-web-sdk";
import type { EmitterType } from "./InternalEmitter";
import { EnsureReconnectEvent } from "./constants";
import { wait } from "./Utils/Common";

export type ReconnectRefresherContext = {
    emitter: EmitterType;
};

// 白板重连之后会刷新所有的对象，导致 listener 失效, 所以这里在重连之后重新对所有对象进行监听
export class ReconnectRefresher {
    private phase?: RoomPhase;
    private room: Room | undefined;
    private reactors: Map<string, any> = new Map();
    private disposers: Map<string, any> = new Map();

    constructor(private ctx: ReconnectRefresherContext) {}

    public setRoom(room: Room | undefined) {
        this.room = room;
        this.phase = room?.phase;
        if (room) {
            room.callbacks.off("onPhaseChanged", this.onPhaseChanged);
            room.callbacks.on("onPhaseChanged", this.onPhaseChanged);
            // 重连成功之后向服务发送一次消息, 确认当前的状态是最新的
            room.addMagixEventListener(
                EnsureReconnectEvent,
                payload => {
                    if (payload.authorId === room.observerId) {
                        this.onReconnected();
                    }
                },
                { fireSelfEventAfterCommit: true }
            );
        }
    }

    public setContext(ctx: ReconnectRefresherContext) {
        this.ctx = ctx;
    }

    private onPhaseChanged = async (phase: RoomPhase) => {
        if (phase === RoomPhase.Reconnecting) {
            this.ctx.emitter.emit("startReconnect");
        }
        if (phase === RoomPhase.Connected && this.phase === RoomPhase.Reconnecting) {
            if (this.room?.isWritable) {
                this.room?.dispatchMagixEvent(EnsureReconnectEvent, {});
            } else {
                await wait(500);
                this.onReconnected();
            }
        }
        this.phase = phase;
    };

    private onReconnected = debounce(() => {
        this._onReconnected();
    }, 1000);

    private _onReconnected = () => {
        log("onReconnected refresh reactors");
        this.releaseDisposers();
        this.reactors.forEach((func, id) => {
            if (isFunction(func)) {
                this.disposers.set(id, func());
            }
        });
        this.ctx.emitter.emit("onReconnected");
    };

    private releaseDisposers() {
        this.disposers.forEach(disposer => {
            if (isFunction(disposer)) {
                disposer();
            }
        });
        this.disposers.clear();
    }

    public refresh() {
        this._onReconnected();
    }

    public add(id: string, func: any) {
        const disposer = this.disposers.get(id);
        if (disposer && isFunction(disposer)) {
            disposer();
        }
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

    public hasReactor(id: string) {
        return this.reactors.has(id);
    }

    public destroy() {
        this.room?.callbacks.off("onPhaseChanged", this.onPhaseChanged);
        this.room?.removeMagixEventListener(EnsureReconnectEvent, this.onReconnected);
        this.releaseDisposers();
    }
}
