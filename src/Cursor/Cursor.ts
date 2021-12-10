import App from './Cursor.svelte';
import { ApplianceMap } from './icons';
import { ApplianceNames } from 'white-web-sdk';
import { CursorState } from '../constants';
import { omit } from 'lodash';
import type { Position } from '../AttributesDelegate';
import type { RoomMember , View } from "white-web-sdk";
import type { CursorContext } from "./index";
import type { SvelteComponent } from "svelte";

export type Payload = {
    [key: string]: any
}


export class Cursor {
    private member?: RoomMember;
    private timer?: number;
    private component?: SvelteComponent;

    constructor(
        private mainView: View,
        private memberId: string,
        private context: CursorContext,
        private wrapper?: HTMLElement,
    ) {
        this.setMember();
        context.onCursorChange(({ position, state }: any) => {
            if (!position && !state) return;
            if (position.type === "main") {
                const rect = this.context.wrapperRect;
                if (this.component && rect) {
                    this.autoHidden();
                    this.moveCursor(position, rect, this.mainView);
                }
            } else {
                const focusView = this.context.focusView;
                const viewRect = focusView?.divElement?.getBoundingClientRect();
                const viewCamera = focusView?.camera;
                if (focusView && viewRect && viewCamera && this.component) {
                    this.autoHidden();
                    this.moveCursor(position, viewRect, focusView);
                }
            }
            if (state && state === CursorState.Leave) {
                this.hide();
            } else if (state && state === CursorState.Normal) {
                if (!this.component) {
                    this.createCursor();
                }
            }
        })
        this.autoHidden();
    }

    private moveCursor(cursor: Position, rect: DOMRect, view: View) {
        const { x, y } = cursor;
        const point = view?.convertToPointOnScreen(x, y);
        if (point) {
            const translateX = point.x + rect.x - 2;
            const translateY = point.y + rect.y - 18;
            if (point.x < 0 || point.x > rect.width || point.y < 0 || point.y > rect.height) {
                this.component?.$set({ visible: false });
            } else {
                this.component?.$set({ visible: true, x: translateX, y: translateY });
            }
        }
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

    private autoHidden() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = window.setTimeout(() => {
            this.hide();
            this.context.updateCursorState(this.memberId, CursorState.Leave);
        }, 1000 * 10); // 10 秒钟自动隐藏
    }

    private async createCursor() {
        if (this.member && this.wrapper) {
            this.component = new App({
                target: document.documentElement,
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
        this.member = this.context.findMemberByUid(this.memberId);
        this.updateComponent();
    }

    private updateComponent() {
        this.component?.$set(omit(this.initProps(), ["x", "y"]));
    }

    public hide() {
        if (this.component) {
            this.component.$set({ visible: false });
        }
    }

    public destroy() {
        this.context.flushSideEffect(this.memberId);
        if (this.component) {
            this.component.$destroy();
        }
    }
}
