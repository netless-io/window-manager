import { autorun } from "white-web-sdk";
import { compact, debounce, get, uniq } from "lodash";
import { Cursor } from "./Cursor";
import { CursorState } from "../constants";
import { emitter, WindowManager } from "../index";
import { Fields } from "../AttributesDelegate";
import { onObjectInserted } from "../Utils/Reactive";
import { SideEffectManager } from "side-effect-manager";
import type { PositionType, Position } from "../AttributesDelegate";
import type { Point, RoomMember, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";

export type EventType = {
    type: PositionType;
    id?: string;
};

export type MoveCursorParams = {
    uid: string;
    x: number;
    y: number;
};
export class CursorManager {
    public containerRect?: DOMRect;
    public wrapperRect?: DOMRect;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];
    private mainViewElement?: HTMLDivElement;
    private sideEffectManager = new SideEffectManager();
    private store = this.manager.store;

    constructor(private manager: AppManager) {
        this.roomMembers = this.manager.room?.state.roomMembers;
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            this.setupWrapper(wrapper);
        }
        emitter.on("onReconnected", () => {
            this.onReconnect();
        });
    }

    public setupWrapper(wrapper: HTMLElement) {
        if (this.manager.refresher?.hasReactor("cursors")) {
            this.destroy();
        }
        this.sideEffectManager.add(() => {
            wrapper.addEventListener("pointerenter", this.mouseMoveListener);
            wrapper.addEventListener("pointermove", this.mouseMoveListener);
            wrapper.addEventListener("pointerleave", this.mouseLeaveListener);
            return () => {
                wrapper.removeEventListener("pointerenter", this.mouseMoveListener);
                wrapper.removeEventListener("pointermove", this.mouseMoveListener);
                wrapper.removeEventListener("pointerleave", this.mouseLeaveListener);
            };
        });

        this.initCursorAttributes();
        this.wrapperRect = wrapper.getBoundingClientRect();
        this.startReaction(wrapper);
    }

    public setMainViewDivElement(div: HTMLDivElement) {
        this.mainViewElement = div;
    }

    private startReaction(wrapper: HTMLElement) {
        this.manager.refresher?.add("cursors", () => {
            return onObjectInserted(this.cursors, () => {
                this.handleRoomMembersChange(wrapper);
            });
        });
    }

    private getUids = (members: readonly RoomMember[] | undefined) => {
        return compact(uniq(members?.map(member => member.payload?.uid)));
    };

    private handleRoomMembersChange = debounce((wrapper: HTMLElement) => {
        const uids = this.getUids(this.roomMembers);
        const cursors = Object.keys(this.cursors);
        if (uids?.length) {
            cursors.map(uid => {
                if (uids.includes(uid) && !this.cursorInstances.has(uid)) {
                    if (uid === this.manager.uid) {
                        return;
                    }
                    const component = new Cursor(
                        this.manager,
                        this.addCursorChangeListener,
                        this.cursors,
                        uid,
                        this,
                        wrapper
                    );
                    this.cursorInstances.set(uid, component);
                }
            });
        }
    }, 100);

    public get cursors() {
        return this.manager.attributes?.[Fields.Cursors];
    }

    public get boxState() {
        return this.store.getBoxState();
    }

    public get focusView() {
        return this.manager.focusApp?.view;
    }

    private mouseMoveListener = debounce((event: MouseEvent) => {
        this.updateCursor(this.getType(event), event.clientX, event.clientY);
    }, 5);

    private updateCursor(event: EventType, clientX: number, clientY: number) {
        if (this.wrapperRect && this.manager.canOperate) {
            const view = event.type === "main" ? this.manager.mainView : this.focusView;
            const point = this.getPoint(view, clientX, clientY);
            if (point) {
                this.setNormalCursorState();
                this.store.updateCursor(this.manager.uid, {
                    x: point.x,
                    y: point.y,
                    ...event,
                });
            }
        }
    }

    private getPoint = (
        view: View | undefined,
        clientX: number,
        clientY: number
    ): Point | undefined => {
        const rect = view?.divElement?.getBoundingClientRect();
        if (rect) {
            const point = view?.convertToPointInWorld({
                x: clientX - rect.x,
                y: clientY - rect.y,
            });
            return point;
        }
    };

    /**
     *  因为窗口内框在不同分辨率下的大小不一样，所以这里通过来鼠标事件的 target 来判断是在主白板还是在 APP 中
     */
    private getType = (event: MouseEvent | Touch): EventType => {
        const target = event.target as HTMLElement;
        const focusApp = this.manager.focusApp;
        switch (target.parentElement) {
            case this.mainViewElement: {
                return { type: "main" };
            }
            case focusApp?.view?.divElement: {
                return { type: "app" };
            }
            default: {
                return { type: "main" };
            }
        }
    };

    private initCursorAttributes() {
        this.store.updateCursor(this.manager.uid, {
            x: 0,
            y: 0,
            type: "main",
        });
        this.store.updateCursorState(this.manager.uid, CursorState.Leave);
    }

    private setNormalCursorState() {
        const cursorState = this.store.getCursorState(this.manager.uid);
        if (cursorState !== CursorState.Normal) {
            this.store.updateCursorState(this.manager.uid, CursorState.Normal);
        }
    }

    private mouseLeaveListener = () => {
        this.hideCursor(this.manager.uid);
        this.store.updateCursorState(this.manager.uid, CursorState.Leave);
    };

    public updateContainerRect() {
        this.containerRect = WindowManager.container?.getBoundingClientRect();
        this.wrapperRect = WindowManager.wrapper?.getBoundingClientRect();
    }

    public setRoomMembers(members: readonly RoomMember[]) {
        this.roomMembers = members;
        this.cursorInstances.forEach(cursor => {
            cursor.setMember();
        });
        if (WindowManager.wrapper) {
            this.handleRoomMembersChange(WindowManager.wrapper);
        }
    }

    public deleteCursor(uid: string) {
        this.store.cleanCursor(uid);
        const cursor = this.cursorInstances.get(uid);
        if (cursor) {
            cursor.destroy();
        }
    }

    public hideCursor(uid: string) {
        const cursor = this.cursorInstances.get(uid);
        if (cursor) {
            cursor.hide();
        }
    }

    public cleanMemberAttributes(members: readonly RoomMember[]) {
        const uids = this.getUids(members);
        const needDeleteIds: string[] = [];
        const cursors = Object.keys(this.cursors);
        cursors.map(cursorId => {
            const index = uids.findIndex(id => id === cursorId);
            if (index === -1) {
                needDeleteIds.push(cursorId);
            }
        });
        needDeleteIds.forEach(uid => {
            this.deleteCursor(uid);
        });
    }

    public onReconnect() {
        if (this.cursorInstances.size) {
            this.cursorInstances.forEach(cursor => cursor.destroy());
            this.cursorInstances.clear();
        }
        this.roomMembers = this.manager.room?.state.roomMembers;
        if (WindowManager.wrapper) {
            this.handleRoomMembersChange(WindowManager.wrapper);
        }
    }

    public addCursorChangeListener = (
        uid: string,
        callback: (position: Position, state: CursorState) => void
    ) => {
        this.manager.refresher?.add(uid, () => {
            const disposer = autorun(() => {
                const position = get(this.cursors, [uid, Fields.Position]);
                const state = get(this.cursors, [uid, Fields.CursorState]);
                if (position) {
                    callback(position, state);
                }
            });
            return disposer;
        });
    };

    public destroy() {
        this.sideEffectManager.flushAll();
        if (this.cursorInstances.size) {
            this.cursorInstances.forEach(cursor => {
                cursor.destroy();
            });
            this.cursorInstances.clear();
        }
        this.manager.refresher?.remove("cursors");
    }
}
