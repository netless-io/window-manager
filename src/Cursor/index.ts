import { Cursor } from "./Cursor";
import { debounce } from "lodash";
import { CursorState } from "../constants";
import { Fields } from "../AttributesDelegate";
import { reaction, listenUpdated, UpdateEventKind } from "white-web-sdk";
import type { RoomMember } from "white-web-sdk";
import { WindowManager } from "../index";
import type { AppManager } from "../AppManager";
import { TELE_BOX_STATE } from "@netless/telebox-insider";

export class CursorManager {
    public containerRect?: DOMRect;
    public wrapperRect?: DOMRect;
    private disposer: any;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];

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

    private startReaction(wrapper: HTMLElement) {
        if (listenUpdated) {
            listenUpdated(this.cursors, (updateEvents) => {
                const kinds = updateEvents.map(e => e.kind);
                if (kinds.includes(UpdateEventKind.Inserted)) {
                    this.handleRoomMembersChange(wrapper);
                }
            });
        } else {
            this.disposer = reaction(
                () => Object.keys(this.cursors || {}).length,
                () => {
                    this.handleRoomMembersChange(wrapper);
                },
                {
                    fireImmediately: true,
                }
            );
        }
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
        return this.manager.attributes[Fields.Cursors];
    }

    public get boxState() {
        return this.appManager.delegate.getBoxState();
    }

    private mouseMoveListener = debounce((event: MouseEvent) => {
        this.updateCursor(event.clientX, event.clientY);
    }, 5);

    private touchMoveListener = debounce((event: TouchEvent) => {
        if (event.touches.length === 1) {
            const touchEvent = event.touches[0];
            this.updateCursor(touchEvent.clientX, touchEvent.clientY);
        }
    }, 5);

    private initCursorAttributes() {
        this.appManager.delegate.updateCursor(this.observerId, {
            x: 0,
            y: 0,
        });
        this.appManager.delegate.updateCursorState(this.observerId, CursorState.Leave);
    }

    public getBoxTitleHeight() {
        if (this.boxState === TELE_BOX_STATE.Maximized) {
            const box = this.appManager.boxManager.getTopBox();
            if (box) {
                return box.$titleBar?.clientHeight;
            }
        }
    }

    public getFocusBox() {
        return this.appManager.boxManager.getFocusBox();
    }

    private updateCursor(clientX: number, clientY: number) {
        if (this.wrapperRect && this.manager.canOperate) {
            const titleHeight = this.getBoxTitleHeight();
            const wrapperWidth = this.wrapperRect.width;
            let wrapperHeight = this.wrapperRect.height;
            if (titleHeight) {
                wrapperHeight = wrapperHeight - titleHeight;
            }
            const x = (clientX - this.wrapperRect.x) / wrapperWidth;
            const y = (clientY - this.wrapperRect.y) / wrapperHeight;
            if (this.appManager.delegate.getCursorState(this.observerId)) {
                this.appManager.delegate.updateCursorState(this.observerId, CursorState.Normal);
            }
            this.appManager.delegate.updateCursor(this.observerId, {
                x,
                y,
            });
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
