import { Cursor } from "./Cursor";
import { CursorState } from "../constants";
import { debounce } from "lodash";
import { Fields } from "../AttributesDelegate";
import { onObjectInserted } from "../Utils/Reactive";
import { WindowManager } from "../index";
import type { PositionType } from "../AttributesDelegate";
import type { Point, RoomMember, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";

export type EventType = {
    type: PositionType;
    id?: string;
};
export class CursorManager {
    public containerRect?: DOMRect;
    public wrapperRect?: DOMRect;
    private disposer: any;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];
    private mainViewElement?: HTMLDivElement;
    private store = this.appManager.store;

    constructor(private manager: WindowManager, private appManager: AppManager) {
        this.roomMembers = this.manager.room?.state.roomMembers;
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
        const memberIds = this.roomMembers?.map(member => member.memberId);
        if (memberIds?.length) {
            for (const memberId in this.cursors) {
                if (
                    memberIds.includes(Number(memberId)) &&
                    !this.cursorInstances.has(memberId) &&
                    memberId !== this.observerId
                ) {
                    const component = new Cursor(
                        this.manager,
                        this.cursors,
                        memberId,
                        this,
                        wrapper
                    );
                    this.cursorInstances.set(memberId, component);
                }
            }
        }
    }

    private get observerId() {
        return String(this.manager.displayer.observerId);
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
                this.store.updateCursor(this.observerId, {
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
        this.store.updateCursor(this.observerId, {
            x: 0,
            y: 0,
            type: "main",
        });
        this.store.updateCursorState(this.observerId, CursorState.Leave);
    }

    private setNormalCursorState() {
        const cursorState = this.store.getCursorState(this.observerId);
        if (cursorState !== CursorState.Normal) {
            this.store.updateCursorState(this.observerId, CursorState.Normal);
        }
    }

    private mouseLeaveListener = () => {
        this.hideCursor(this.observerId);
        this.store.updateCursorState(this.observerId, CursorState.Leave);
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

    public cleanMemberCursor(memberId: string) {
        this.store.cleanCursor(memberId);
        const cursor = this.cursorInstances.get(memberId);
        if (cursor) {
            cursor.destroy();
        }
    }

    public hideCursor(memberId: string) {
        const cursor = this.cursorInstances.get(memberId);
        if (cursor) {
            cursor.hide();
        }
    }

    public cleanMemberAttributes(members: readonly RoomMember[]) {
        const memberIds = members.map(member => member.memberId);
        const needDeleteIds = [];
        for (const memberId in this.cursors) {
            const index = memberIds.findIndex(id => id === Number(memberId));
            if (index === -1) {
                needDeleteIds.push(memberId);
            }
        }
        needDeleteIds.forEach(memberId => {
            const instance = this.cursorInstances.get(memberId);
            if (instance) {
                instance.destroy();
            }
            this.store.cleanCursor(memberId);
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
