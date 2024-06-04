import type { RoomMember } from "white-web-sdk";
import type { CursorOptions } from "../index";
import type { AppManager } from "../AppManager";
import type { Position } from "../AttributesDelegate";
import type { CursorManager } from "./index";

import { omit } from "lodash";
import { ApplianceNames } from "white-web-sdk";

import { findMemberByUid } from "../Helper";
import App from "./Cursor.svelte";
import { remoteIcon } from "./icons2";

export type Payload = {
    [key: string]: any;
};

export class Cursor {
    private member?: RoomMember;
    private timer?: number;
    private component?: App;
    private style: CursorOptions["style"] & string = "default";

    constructor(
        private manager: AppManager,
        private memberId: string,
        private cursorManager: CursorManager,
        private wrapper?: HTMLElement
    ) {
        this.updateMember();
        this.createCursor();
        this.autoHidden();
        this.setStyle(cursorManager.style);
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

    public setStyle = (style: typeof this.style) => {
        this.style = style;
        if (this.component) {
            this.component.$set({
                src: this.getIcon(),
                custom: this.isCustomIcon(),
            });
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
            if (this.isCustomIcon()) {
                translateX -= 11;
                translateY += 4;
            }
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

    public get memberColorHex(): string {
        const [r, g, b] = this.member?.memberState?.strokeColor || [236, 52, 85];
        return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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
            uid: this.memberId,
            x: 0,
            y: 0,
            appliance: this.memberApplianceName as string,
            avatar: this.memberAvatar,
            src: this.getIcon(),
            custom: this.isCustomIcon(),
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

    private getIcon(): string | undefined {
        if (!this.member) return;

        const { memberApplianceName, memberColorHex } = this;
        const { userApplianceIcons, applianceIcons } = this.cursorManager;

        let iconsKey: string | undefined = this.memberApplianceName;
        if (iconsKey === ApplianceNames.pencilEraser) {
            iconsKey = `${iconsKey}${this.member?.memberState.pencilEraserSize || 1}`;
        }

        const userApplianceSrc = iconsKey && userApplianceIcons[iconsKey];
        if (userApplianceSrc) return userApplianceSrc;

        if (this.style === "custom" && memberApplianceName) {
            const customApplianceSrc = remoteIcon(memberApplianceName, memberColorHex);
            if (customApplianceSrc) return customApplianceSrc;
        }

        const applianceSrc = applianceIcons[iconsKey || ApplianceNames.shape];
        return applianceSrc || applianceIcons[ApplianceNames.shape];
    }

    private isCustomIcon(): boolean {
        if (!this.member) return false;

        const { memberApplianceName, memberColorHex } = this;
        const { userApplianceIcons } = this.cursorManager;

        let iconsKey: string | undefined = this.memberApplianceName;
        if (iconsKey === ApplianceNames.pencilEraser) {
            iconsKey = `${iconsKey}${this.member?.memberState.pencilEraserSize || 1}`;
        }

        const userApplianceSrc = iconsKey && userApplianceIcons[iconsKey];
        if (userApplianceSrc) return false;

        if (this.style === "custom" && memberApplianceName) {
            const customApplianceSrc = remoteIcon(memberApplianceName, memberColorHex);
            if (customApplianceSrc) return true;
        }

        return false;
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
