import { Cursor } from './Cursor';
import { debounce } from 'lodash-es';
import { Events } from '../constants';
import { Fields } from '../AttributesDelegate';
import { reaction, RoomMember } from 'white-web-sdk';
import { WindowManager } from '../index';
import type { AppManager } from "../AppManager";

export class CursorManager {
    public containerRect?: DOMRect;
    private observerId = this.manager.displayer.observerId;
    private disposer: any;
    public components: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];

    constructor(
        private manager: WindowManager,
        private appManager: AppManager,
    ) {
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            wrapper.addEventListener("mousemove", this.mouseMoveListener);
            wrapper.addEventListener("mouseleave", this.mouseLeaveListener);
            this.containerRect = wrapper.getBoundingClientRect();
            this.initDisposer(wrapper);
        }
        this.roomMembers = this.manager.room?.state.roomMembers;
    }

    private initDisposer(wrapper: HTMLElement) {
        this.disposer = reaction(
            () => Object.keys(this.cursors || {}).length,
            () => {
                const memberIds = this.roomMembers?.map(member => member.memberId);
                for (const memberId in this.cursors) {
                    if (memberIds &&
                        memberIds.includes(Number(memberId)) &&
                        !this.components.has(memberId) &&
                        memberId !== String(this.observerId)) {
                        const component = new Cursor(this.manager, this.cursors, memberId, this, wrapper);
                        this.components.set(memberId, component);
                    }
                }
            }, {
                fireImmediately: true
            }
        )
    }

    public get cursors() {
        return this.manager.attributes[Fields.Cursors];
    }

    private mouseMoveListener = debounce((event: MouseEvent) => {
        if (this.containerRect) {
            const x = (event.clientX - this.containerRect.x) / this.containerRect.width;
            const y = (event.clientY - this.containerRect.y) / this.containerRect.height;
            this.appManager.delegate.updateCursor(String(this.observerId), {
                x, y
            });
        }
    }, 5)

    private mouseLeaveListener = () => {
        this.hideComponent(String(this.observerId));
        this.appManager.dispatchInternalEvent(Events.CursorLeave, { memberId: String(this.observerId) });
    }

    public updateContainerRect() {
        this.containerRect = WindowManager.wrapper?.getBoundingClientRect();
    }

    public setRoomMembers(members: readonly RoomMember[]) {
        this.roomMembers = members;
        this.components.forEach(component => {
            component.setMember();
        });
    }

    public cleanMemberComponent(memberId: string) {
        this.appManager.delegate.cleanCursor(memberId);
        const component = this.components.get(memberId);
        if (component) {
            component.destroy();
        }
    }

    public hideComponent(memberId: string) {
        const component = this.components.get(memberId);
        if (component) {
            component.hide();
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
            this.appManager.delegate.cleanCursor(memberId);
        });
    }

    public destroy() {
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            wrapper.removeEventListener("mousemove", this.mouseMoveListener);
            wrapper.removeEventListener("mouseleave", this.mouseLeaveListener);
        }
        this.disposer && this.disposer();
        if (this.components.size) {
            this.components.forEach(component => component.destroy());
            this.components.clear();
        }
    }
}
