import App from './Cursor.svelte';
import { ApplianceMap } from './icons';
import { ApplianceNames, autorun, RoomMember, reaction } from 'white-web-sdk';
import { omit } from 'lodash-es';
import type { CursorManager } from "./index";
import type { WindowManager } from "../index";
import type { SvelteComponent } from "svelte";
import { Fields } from '../AttributesDelegate';
import { CursorState } from '../constants';

export class Cursor {
    private member?: RoomMember;
    private disposers: Array<any> = [];
    private timer?: number;
    private component?: SvelteComponent;

    constructor(
        private manager: WindowManager,
        private cursors: any,
        private memberId: string,
        private cursorManager: CursorManager,
        private wrapper?: HTMLElement,
    ) {
        this.setMember();
        this.createCursor();
        this.disposers.push(reaction(
            () => this.cursors[this.memberId][Fields.Position],
            cursor => {
                if (!cursor) return;
                const x = cursor.x;
                const y = cursor.y;
                const rect = this.cursorManager.containerRect;
                if (this.component && rect) {
                    this.autoHidden();
                    const translateX = x * rect.width - (180 / 2) + 26 + 2; // x 需要减去一半的 cursor 的宽, 加上 icon 的宽
                    const translateY = y * rect.height - 74 + 1; // y 减去 cursor 的高
                    this.component.$set({ visible: true, x: translateX, y: translateY });
                }
            }, {
                fireImmediately: true
            }
        ));
        this.disposers.push(reaction(
            () => this.cursorState,
            state => {
                if (state === CursorState.Leave) {
                    this.hide();
                }
            }, {
                fireImmediately: true
            }
        ));
        this.autoHidden();
    }

    public get memberApplianceName() {
        return this.member?.memberState.currentApplianceName;
    }

    public get memberColor() {
        const rgb = this.member?.memberState.strokeColor.join(",");
        return `rgb(${rgb})`;
    }

    public get memberCursorName() {
        return this.member?.payload.cursorName;
    }

    private get memberTheme() {
        if (this.member?.payload.theme) {
            return "cursor-inner-mellow";
        } else {
            return "cursor-inner";
        }
    }

    private get memberCursorTextColor() {
        return this.member?.payload.cursorTextColor || "#FFFFFF";
    }

    private get memberCursorTagBackgroundColor() {
        return this.member?.payload.cursorTagBackgroundColor || this.memberColor;
    }

    private get memberAvatar() {
        return this.member?.payload.avatar;
    }

    private get memberOpacity() {
        if (!this.memberCursorName && !this.memberAvatar) {
            return 0;
        } else {
            return 1;
        }
    }

    public get cursorState() {
        return this.cursors[this.memberId][Fields.CursorState]
    }

    private get cursorVisible() {
        return this.cursorState !== CursorState.Leave;
    }

    private autoHidden() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = window.setTimeout(() => {
            this.hide();
        }, 1000 * 10); // 10 秒钟自动隐藏
    }

    private async createCursor() {
        if (this.member && this.wrapper) {
            this.component = new App({
                target: this.wrapper,
                props: this.initProps()
            });
        }
    }

    private initProps() {
        return {
            x: 0,
            y: 0,
            appliance: this.memberApplianceName,
            avatar: this.memberAvatar,
            src: this.getIcon(),
            visible: this.cursorVisible,
            backgroundColor: this.memberColor,
            cursorName: this.memberCursorName,
            theme: this.memberTheme,
            color: this.memberCursorTextColor,
            cursorTagBackgroundColor: this.memberCursorTagBackgroundColor,
            opacity: this.memberOpacity,
        }
    }

    private getIcon() {
        if (this.member) {
            let icon = ApplianceMap[this.member.memberState.currentApplianceName];
            if (!icon) {
                icon = ApplianceMap[ApplianceNames.shape];
            }
            return icon;
        }
    }

    public setMember() {
        this.member = this.cursorManager.roomMembers?.find(member => member.memberId === Number(this.memberId));
        this.component?.$set(omit(this.initProps(), ["x", "y", "visible"]));
    }

    public destroy() {
        this.disposers.forEach(disposer => disposer());
        if (this.component) {
            this.component.$destroy();
        }
        this.cursorManager.cursorInstances.delete(this.memberId);
    }

    public hide() {
        if (this.component) {
            this.component.$set({ visible: false });
        }
    }
}
