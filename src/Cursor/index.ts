import { Base } from '../Base';
import { Cursor } from './Cursor';
import { CursorState } from '../constants';
import { debounce } from 'lodash';
import { Fields } from '../AttributesDelegate';
import { onObjectInserted } from '../Utils/Reactive';
import { WindowManager } from '../index';
import type { PositionType } from "../AttributesDelegate";
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
}
export class CursorManager extends Base {
    public containerRect?: DOMRect;
    public wrapperRect?: DOMRect;
    private disposer: any;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];
    private mainViewElement?: HTMLDivElement;

    constructor(private appManager: AppManager) {
        super(appManager);
        this.roomMembers = this.appManager.room?.state.roomMembers;
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            wrapper.addEventListener("mousemove", this.mouseMoveListener);
            wrapper.addEventListener("touchstart", this.touchMoveListener);
            wrapper.addEventListener("touchmove", this.touchMoveListener);
            wrapper.addEventListener("mouseleave", this.mouseLeaveListener);
            wrapper.addEventListener("touchend", this.mouseLeaveListener);
            this.initCursorAttributes();
            this.wrapperRect = wrapper.getBoundingClientRect();
            this.startReaction(wrapper);
        }
    }

    public setMainViewDivElement(div: HTMLDivElement) {
        this.mainViewElement = div;
    }

    private startReaction(wrapper: HTMLElement) {
        this.disposer = onObjectInserted(this.cursors, () => {
            this.handleRoomMembersChange(wrapper);
        });
    }

    private handleRoomMembersChange(wrapper: HTMLElement) {
        const uids = this.roomMembers?.map(member => member.payload?.uid);
        if (uids?.length) {
            for (const uid in this.cursors) {
                if (
                    uids.includes(uid) &&
                    !this.cursorInstances.has(uid) &&
                    uid !== this.context.uid
                ) {
                    const component = new Cursor(
                        this.appManager,
                        this.cursors,
                        uid,
                        this,
                        wrapper
                    );
                    this.cursorInstances.set(uid, component);
                }
            }
        }
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
        if (this.wrapperRect && this.manager.canOperate) {
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

    private getPoint = (view: View | undefined, clientX: number, clientY: number): Point | undefined => {
        const rect = view?.divElement?.getBoundingClientRect();
        if (rect) {
            const point = view?.convertToPointInWorld({
                x: clientX - rect.x,
                y: clientY - rect.y,
            });
            return point;
        }
    }

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

    public cleanMemberCursor(uid: string) {
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
        const uids = members.map(member => member.payload?.uid);
        const needDeleteIds = [];
        for (const uid in this.cursors) {
            const index = uids.findIndex(id => id === uid);
            if (index === -1) {
                needDeleteIds.push(uid);
            }
        }
        needDeleteIds.forEach(uid => {
            const instance = this.cursorInstances.get(uid);
            if (instance) {
                instance.destroy();
            }
            this.store.cleanCursor(uid);
        });
    }

    public destroy() {
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            wrapper.removeEventListener("mousemove", this.mouseMoveListener);
            wrapper.removeEventListener("touchstart", this.touchMoveListener);
            wrapper.removeEventListener("touchmove", this.touchMoveListener);
            wrapper.removeEventListener("mouseleave", this.mouseLeaveListener);
            wrapper.removeEventListener("touchend", this.mouseLeaveListener);
        }
        this.disposer && this.disposer();
        if (this.cursorInstances.size) {
            this.cursorInstances.forEach(cursor => cursor.destroy());
            this.cursorInstances.clear();
        }
    }
}
