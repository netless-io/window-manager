import { autorun } from 'white-web-sdk';
import { Base } from '../Base';
import { compact, debounce, uniq } from 'lodash';
import { Cursor } from './Cursor';
import { CursorState } from '../constants';
import { emitter, WindowManager } from '../index';
import { Fields } from '../AttributesDelegate';
import { onObjectInserted } from '../Utils/Reactive';
import { SideEffectManager } from 'side-effect-manager';
import type { PositionType } from "../AttributesDelegate";
import type { RoomMember, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { Point } from "../typings";

export type EventType = {
    type: PositionType;
    id?: string;
};

export type MoveCursorParams = {
    uid: string;
    x: number;
    y: number;
};

export type CursorContext = {
    focusView: View | undefined;
    wrapperRect?: DOMRect;
    findMemberByUid: (uid: string) => RoomMember | undefined;
    updateCursorState: (uid: string, state: CursorState) => void;
    onCursorChange: (callback: (state: any) => void) => void;
    flushSideEffect: (uid: string) => void;
};

export class CursorManager extends Base {
    private _wrapperRect?: DOMRect;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];
    private mainViewElement?: HTMLDivElement;
    private sideEffectManager = new SideEffectManager();
    private reactionId = "cursors";

    constructor(private appManager: AppManager) {
        super(appManager);
        this.roomMembers = this.appManager.room?.state.roomMembers;
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            this.sideEffectManager.add(() => {
                wrapper.addEventListener("mousemove", this.mouseMoveListener);
                wrapper.addEventListener("touchstart", this.touchMoveListener);
                wrapper.addEventListener("touchmove", this.touchMoveListener);
                wrapper.addEventListener("mouseleave", this.mouseLeaveListener);
                wrapper.addEventListener("touchend", this.mouseLeaveListener);
                return () => {
                    wrapper.removeEventListener("mousemove", this.mouseMoveListener);
                    wrapper.removeEventListener("touchstart", this.touchMoveListener);
                    wrapper.removeEventListener("touchmove", this.touchMoveListener);
                    wrapper.removeEventListener("mouseleave", this.mouseLeaveListener);
                    wrapper.removeEventListener("touchend", this.mouseLeaveListener);
                };
            });

            this.initCursorAttributes();
            this._wrapperRect = wrapper.getBoundingClientRect();
            this.startReaction(wrapper);
            emitter.on("roomMembersChange", roomMembers => {
                this.roomMembers = roomMembers;
                this.setRoomMembers(roomMembers);
                this.cleanMemberAttributes(roomMembers);
            });
        }
    }

    private get wrapperRect() {
        return this._wrapperRect;
    }

    public setMainViewDivElement(div: HTMLDivElement) {
        this.mainViewElement = div;
    }

    private startReaction(wrapper: HTMLElement) {
        this.manager.refresher?.add(this.reactionId, () => {
            return onObjectInserted(this.cursors, () => {
                this.handleRoomMembersChange(wrapper);
            });
        });
    }

    private getUids = (members: readonly RoomMember[] | undefined) => {
        return compact(uniq(members?.map(member => member.payload?.uid)));
    };

    private handleRoomMembersChange = (wrapper: HTMLElement) => {
        const uids = this.getUids(this.roomMembers);
        const cursors = Object.keys(this.cursors);
        if (uids?.length) {
            cursors.map(uid => {
                if (uids.includes(uid) && !this.cursorInstances.has(uid)) {
                    if (uid === this.context.uid) {
                        return;
                    }
                    const component = new Cursor(
                        this.appManager.mainView,
                        uid,
                        {
                            findMemberByUid: this.context.findMemberByUid,
                            updateCursorState: this.updateCursorState,
                            onCursorChange: this.onCursorChange(uid),
                            flushSideEffect: this.flushSideEffect,
                            focusView: this.focusView,
                            wrapperRect: this.wrapperRect,
                        },
                        wrapper
                    );
                    this.cursorInstances.set(uid, component);
                }
            });
        }
    };

    private onCursorChange = (uid: string) => {
       return (callback: (state: any) => void) => {
           this.sideEffectManager.add(() => {
               const disposer = autorun(() => {
                    const position = this.cursors?.[uid]?.[Fields.Position];
                    const state = this.cursors?.[uid]?.[Fields.CursorState];
                    callback({ position, state });
               })
               return disposer;
           }, uid);
       }
    };

    private flushSideEffect = (uid: string) => {
        this.sideEffectManager.flush(uid);
    }

    public get cursors() {
        return this.manager.attributes?.[Fields.Cursors];
    }

    public get boxState() {
        return this.store.getBoxState();
    }

    public get focusView() {
        return this.appManager.focusApp?.view;
    }

    private mouseMoveListener = debounce((event: MouseEvent) => {
        this.updateCursor(this.getType(event), event.clientX, event.clientY);
    }, 5);

    private touchMoveListener = debounce((event: TouchEvent) => {
        if (event.touches.length === 1) {
            const touchEvent = event.touches[0];
            this.updateCursor(this.getType(touchEvent), touchEvent.clientX, touchEvent.clientY);
        }
    }, 5);

    private updateCursor(event: EventType, clientX: number, clientY: number) {
        if (this._wrapperRect && this.manager.canOperate) {
            const view = event.type === "main" ? this.appManager.mainView : this.focusView;
            const point = this.getPoint(view, clientX, clientY);
            if (point) {
                this.setNormalCursorState();
                this.store.updateCursor(this.context.uid, {
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
        const focusApp = this.appManager.focusApp;
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
        this.store.updateCursor(this.context.uid, {
            x: 0,
            y: 0,
            type: "main",
        });
        this.store.updateCursorState(this.context.uid, CursorState.Leave);
    }

    private setNormalCursorState() {
        const cursorState = this.store.getCursorState(this.context.uid);
        if (cursorState !== CursorState.Normal) {
            this.store.updateCursorState(this.context.uid, CursorState.Normal);
        }
    }

    private mouseLeaveListener = () => {
        this.hideCursor(this.context.uid);
        this.store.updateCursorState(this.context.uid, CursorState.Leave);
    };

    public updateContainerRect() {
        this._wrapperRect = WindowManager.wrapper?.getBoundingClientRect();
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
            this.cursorInstances.delete(uid);
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

    private updateCursorState = (uid: string, state: CursorState) => {
        this.store.updateCursorState(uid, state);
    };

    public destroy() {
        if (this.cursorInstances.size) {
            this.cursorInstances.forEach(cursor => cursor.destroy());
            this.cursorInstances.clear();
        }
        this.manager.refresher?.remove(this.reactionId);
        this.sideEffectManager.flushAll();
    }
}
