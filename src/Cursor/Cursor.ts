import App from './Cursor.svelte';
import pRetry from 'p-retry';
import { ApplianceMap } from './icons';
import { ApplianceNames, autorun } from 'white-web-sdk';
import { CursorState } from '../constants';
import { Fields } from '../AttributesDelegate';
import { get, omit } from 'lodash';
import type { Position } from '../AttributesDelegate';
import type { RoomMember } from "white-web-sdk";
import type { CursorManager } from "./index";
import type { SvelteComponent } from "svelte";
import { Base } from '../Base';
import type { AppManager } from '../AppManager';

export type Payload = {
    [key: string]: any
}


export class Cursor extends Base {
    private member?: RoomMember;
    private disposer: any;
    private timer?: number;
    private component?: SvelteComponent;

    constructor(
        manager: AppManager,
        private cursors: any,
        private memberId: string,
        private cursorManager: CursorManager,
        private wrapper?: HTMLElement
    ) {
        super(manager);
        this.setMember();
        this.createCursor();
        pRetry(() => {
            this.disposer && this.disposer();
            if (!this.cursorPosition) {
                console.warn(`${memberId} not exist`);
            }
            this.startReaction();
        }, { retries: 3 });
        this.autoHidden();
    }

    private startReaction() {
        this.disposer = autorun(() => {
            const cursor = this.cursorPosition;
            const state = this.cursorState;
            if (!cursor) return;
            if (cursor.type === "main") {
                const rect = this.cursorManager.wrapperRect;
                if (this.component && rect) {
                    this.autoHidden();
                    this.moveCursor(cursor, rect, this.manager.mainView);
                }
            } else {
                const focusView = this.cursorManager.focusView;
                const viewRect = focusView?.divElement?.getBoundingClientRect();
                const viewCamera = focusView?.camera;
                if (focusView && viewRect && viewCamera && this.component) {
                    this.autoHidden();
                    this.moveCursor(cursor, viewRect, focusView);
                }
            }
            if (state && state === CursorState.Leave) {
                this.hide();
            }
        });
    }

    private moveCursor(cursor: Position, rect: DOMRect, view: any) {
        const { x, y } = cursor;
        const point = view?.screen.convertPointToScreen(x, y);
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

    public get cursorState(): CursorState | undefined {
        return get(this.cursors, [this.memberId, Fields.CursorState]);
    }

    public get cursorPosition(): Position | undefined {
        return get(this.cursors, [this.memberId, Fields.Position]);
    }

    private autoHidden() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = window.setTimeout(() => {
            this.hide();
            this.store.updateCursorState(this.memberId, CursorState.Leave);
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
