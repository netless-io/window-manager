import { Cursor } from './Cursor';
import { CursorState } from '../constants';
import { debounce } from 'lodash';
import { Fields } from '../AttributesDelegate';
import { onObjectInserted } from '../Utils/Reactive';
import { TELE_BOX_STATE } from '@netless/telebox-insider';
import { WindowManager } from '../index';
import type { ReadonlyTeleBox} from '@netless/telebox-insider';
import type { PositionType } from '../AttributesDelegate';
import type { RoomMember } from "white-web-sdk";
import type { AppManager } from "../AppManager";

export type EventType = {
    type: PositionType, 
    id?: string
}
export class CursorManager {
    public containerRect?: DOMRect;
    public wrapperRect?: DOMRect;
    private disposer: any;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];
    private mainViewElement?: HTMLDivElement;

    constructor(private manager: WindowManager, private appManager: AppManager) {
        this.roomMembers = this.manager.room?.state.roomMembers;
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            wrapper.addEventListener("mousemove", this.mouseMoveListener);
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
        return this.appManager.delegate.getBoxState();
    }

    public get focusBox() {
        return this.appManager.boxManager.getFocusBox();
    }

    public get focusView() {
        return this.appManager.focusApp?.view
    }

    private computedAppPosition(x: number, y: number) {
        const viewRect = this.focusView?.divElement?.getBoundingClientRect();
        if (viewRect) {
            const ratioX = (x - viewRect.x) / viewRect.width;
            const ratioY = (y - viewRect.y) / viewRect.height;
            return { x: ratioX, y: ratioY };
        }
    }

    /**
     *  因为窗口内框在不同分辨率下的大小不一样，所以这里通过来鼠标事件的 target 来判断是在主白板还是在 APP 中
     */
    private getType = (event: MouseEvent | Touch): EventType => {
        const target = event.target as HTMLElement;
        const targetIsMain = target.parentElement === this.mainViewElement;
        if (targetIsMain) {
            return { type: "main" };
        } else {
            if (!this.focusView) return { type: "main" };
            const focusApp = this.appManager.focusApp;
            const targetIsFocusApp = target.parentElement === focusApp?.view?.divElement;
            if (targetIsFocusApp) {
                return { type: "app", id: focusApp?.id }
            }
            return { type: "main" };
        }
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

    private initCursorAttributes() {
        this.appManager.delegate.updateCursor(this.observerId, {
            x: 0,
            y: 0,
            type: "main"
        });
        this.appManager.delegate.updateCursorState(this.observerId, CursorState.Leave);
    }

    public getFocusBox() {
        return this.appManager.boxManager.getFocusBox();
    }

    private updateCursor(event: EventType, clientX: number, clientY: number) {
        if (this.wrapperRect && this.manager.canOperate) {
            if (event.type === "main")  {
                const x = (clientX - this.wrapperRect.x) / this.wrapperRect.width;
                const y = (clientY - this.wrapperRect.y) / this.wrapperRect.height;
                this.setNormalCursorState();
                this.appManager.delegate.updateCursor(this.observerId, {
                    x, y, ...event
                });
            } else if (event.type === "app") {
                const appPosition = this.computedAppPosition(clientX, clientY);
                if (appPosition) {
                    this.setNormalCursorState();
                    this.appManager.delegate.updateCursor(this.observerId, {
                        x: appPosition.x, y: appPosition.y, ...event
                    });
                }
            }
        }
    }
    
    private setNormalCursorState() {
        const cursorState = this.appManager.delegate.getCursorState(this.observerId)
        if (cursorState !== CursorState.Normal) {
            this.appManager.delegate.updateCursorState(this.observerId, CursorState.Normal);
        }
    }

    private mouseLeaveListener = () => {
        this.hideCursor(this.observerId);
        this.appManager.delegate.updateCursorState(this.observerId, CursorState.Leave);
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
        this.appManager.delegate.cleanCursor(memberId);
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
            this.appManager.delegate.cleanCursor(memberId);
        });
    }

    public destroy() {
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            wrapper.removeEventListener("mousemove", this.mouseMoveListener);
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
