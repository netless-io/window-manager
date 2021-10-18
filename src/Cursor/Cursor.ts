import App from './Cursor.svelte';
import pRetry from 'p-retry';
import { ApplianceMap } from './icons';
import { ApplianceNames, autorun } from 'white-web-sdk';
import { CursorState } from '../constants';
import { Fields } from '../AttributesDelegate';
import { get, omit } from 'lodash';
import type { RoomMember } from "white-web-sdk";
import type { CursorManager } from "./index";
import type { WindowManager } from "../index";
import type { SvelteComponent } from "svelte";

export type Payload = {
    [key: string]: any
}

export class Cursor {
    private member?: RoomMember;
    private disposer: any;
    private timer?: number;
    private component?: SvelteComponent;

    constructor(
        private manager: WindowManager,
        private cursors: any,
        private memberId: string,
        private cursorManager: CursorManager,
        private wrapper?: HTMLElement
    ) {
        this.setMember();
        this.createCursor();
        pRetry(() => {
            this.disposer && this.disposer();
            if (!this.cursorPosition) {
                throw new Error();
            }
            this.startReaction();
        }, { retries: 3 });
        this.autoHidden();
    }

    private startReaction() {
        this.disposer = autorun(() => {
            const cursor = this.cursorPosition;
            const state = this.cursorState;
            if (cursor) {
                const x = cursor.x;
                const y = cursor.y;
                const rect = this.cursorManager.wrapperRect;
                const containerRect = this.cursorManager.containerRect;
                if (this.component && rect && containerRect) {
                    this.autoHidden();
                    const translateX = x * rect.width - 2; // x 需要减去一半的 cursor 的宽, 加上 icon 的宽
                    const translateY = y * rect.height - 18; // y 减去 cursor 的高
                    this.component.$set({ visible: true, x: translateX, y: translateY });
                }
            }
            if (state && state === CursorState.Leave) {
                this.hide();
            }
        });
    }

    public get memberApplianceName() {
        return this.member?.memberState?.currentApplianceName;
    }

    public get memberColor() {
        const rgb = this.member?.memberState?.strokeColor.join(",");
        return `rgb(${rgb})`;
    }

    private get payload(): Payload | undefined {
        return this.member?.payload;
    }

    public get memberCursorName() {
        return this.payload?.nickName || this.payload?.cursorName || this.memberId;
    }

    private get memberTheme() {
        if (this.payload?.theme) {
            return "netless-window-manager-cursor-inner-mellow";
        } else {
            return "netless-window-manager-cursor-inner";
        }
    }

    private get memberCursorTextColor() {
        return this.payload?.cursorTextColor || "#FFFFFF";
    }

    private get memberCursorTagBackgroundColor() {
        return this.payload?.cursorTagBackgroundColor || this.memberColor;
    }

    private get memberAvatar() {
        return this.payload?.avatar;
    }

    private get memberOpacity() {
        if (!this.memberCursorName && !this.memberAvatar) {
            return 0;
        } else {
            return 1;
        }
    }

    public get cursorState() {
        return get(this.cursors, [this.memberId, Fields.CursorState]);
    }

    public get cursorPosition() {
        return get(this.cursors, [this.memberId, Fields.Position]);
    }

    public getFocusBox() {
        return this.cursorManager.getFocusBox();
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
                props: this.initProps(),
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
            visible: false,
            backgroundColor: this.memberColor,
            cursorName: this.memberCursorName,
            theme: this.memberTheme,
            color: this.memberCursorTextColor,
            cursorTagBackgroundColor: this.memberCursorTagBackgroundColor,
            opacity: this.memberOpacity,
        };
    }

    private getIcon() {
        if (this.member) {
            const applianceSrc = ApplianceMap[this.memberApplianceName || ApplianceNames.shape];
            return applianceSrc || ApplianceMap[ApplianceNames.shape];
        }
    }

    public setMember() {
        this.member = this.cursorManager.roomMembers?.find(
            member => member.memberId === Number(this.memberId)
        );
        this.component?.$set(omit(this.initProps(), ["x", "y", "visible"]));
    }

    public destroy() {
        this.disposer && this.disposer();
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
