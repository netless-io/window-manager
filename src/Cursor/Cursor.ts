import App from "./Cursor.svelte";
import { ApplianceNames } from "white-web-sdk";
import { findMemberByUid } from "../Helper";
import { omit } from "lodash";
import type { Position } from "../AttributesDelegate";
import type { RoomMember } from "white-web-sdk";
import type { CursorManager } from "./index";
import type { SvelteComponent } from "svelte";
import type { AppManager } from "../AppManager";

export type Payload = {
    [key: string]: any;
};

export class Cursor {
    private member?: RoomMember;
    private timer?: number;
    private component?: SvelteComponent;

    constructor(
        private manager: AppManager,
        private memberId: string,
        private cursorManager: CursorManager,
        private wrapper?: HTMLElement
    ) {
        this.updateMember();
        this.createCursor();
        this.autoHidden();
    }

    public move = (position: Position) => {
        if (position.type === "main") {
            const rect = this.cursorManager.wrapperRect;
            if (this.component && rect) {
                this.autoHidden();
                this.moveCursor(position, rect, this.manager.mainView);
            }
        } else {
            const focusView = this.cursorManager.focusView;
            const viewRect = focusView?.divElement?.getBoundingClientRect();
            const viewCamera = focusView?.camera;
            if (focusView && viewRect && viewCamera && this.component) {
                this.autoHidden();
                this.moveCursor(position, viewRect, focusView);
            }
        }
    };

    public leave = () => {
        this.hide();
    };

    private moveCursor(cursor: Position, rect: DOMRect, view: any) {
        const { x, y, type } = cursor;
        const point = view?.screen.convertPointToScreen(x, y);
        if (point) {
            let translateX = point.x - 2;
            let translateY = point.y - 18;
            if (type === "app") {
                const wrapperRect = this.cursorManager.wrapperRect;
                if (wrapperRect) {
                    translateX = translateX + rect.x - wrapperRect.x;
                    translateY = translateY + rect.y - wrapperRect.y;
                }
            }
            if (point.x < 0 || point.x > rect.width || point.y < 0 || point.y > rect.height) {
                this.component?.$set({ visible: false, x: translateX, y: translateY });
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

    private get memberTagName(): string | undefined {
        return this.payload?.cursorTagName;
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
            appliance: this.memberApplianceName as string,
            avatar: this.memberAvatar,
            src: this.getIcon(),
            visible: false,
            backgroundColor: this.memberColor,
            cursorName: this.memberCursorName,
            theme: this.memberTheme,
            color: this.memberCursorTextColor,
            cursorTagBackgroundColor: this.memberCursorTagBackgroundColor,
            opacity: this.memberOpacity,
            tagName: this.memberTagName,
            pencilEraserSize: this.member?.memberState.pencilEraserSize,
        };
    }

    private getIcon() {
        if (this.member) {
            const icons = this.cursorManager.applianceIcons;
            let applianceSrc = icons[ApplianceNames.shape];
            if (this.memberApplianceName === ApplianceNames.pencilEraser) {
                const size = this.member?.memberState.pencilEraserSize || 1;
                applianceSrc = icons[`${this.memberApplianceName}${size}`];
            } else {
                applianceSrc = icons[this.memberApplianceName || ApplianceNames.shape];
            }
            return applianceSrc || icons[ApplianceNames.shape];
        }
    }

    public updateMember() {
        this.member = findMemberByUid(this.manager.room, this.memberId);
        this.updateComponent();
        return this.member;
    }

    private updateComponent() {
        this.component?.$set(omit(this.initProps(), ["x", "y"]));
    }

    public destroy() {
        if (this.component) {
            this.component.$destroy();
        }
        this.cursorManager.cursorInstances.delete(this.memberId);
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }

    public hide() {
        if (this.component) {
            this.component.$set({ visible: false });
            this.destroy();
        }
    }
}
