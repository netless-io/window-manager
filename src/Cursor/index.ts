import { ApplianceNames } from "white-web-sdk";
import { Cursor } from "./Cursor";
import { CursorState, Events } from "../constants";
import { internalEmitter } from "../InternalEmitter";
import { SideEffectManager } from "side-effect-manager";
import { WindowManager } from "../index";
import type { CursorMovePayload, ApplianceIcons } from "../index";
import type { PositionType } from "../AttributesDelegate";
import type { Point, RoomMember, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import { ApplianceMap } from "./icons";
import { findMemberByUid } from "../Helper";

export type EventType = {
    type: PositionType;
    id?: string;
};

export type MoveCursorParams = {
    uid: string;
    x: number;
    y: number;
};

export class CursorManager {
    public containerRect?: DOMRect;
    public wrapperRect?: DOMRect;
    public cursorInstances: Map<string, Cursor> = new Map();
    public roomMembers?: readonly RoomMember[];
    private mainViewElement?: HTMLDivElement;
    private sideEffectManager = new SideEffectManager();
    private store = this.manager.store;
    public applianceIcons: ApplianceIcons = ApplianceMap;

    constructor(private manager: AppManager, private enableCursor: boolean, applianceIcons?: ApplianceIcons) {
        this.roomMembers = this.manager.room?.state.roomMembers;
        const wrapper = WindowManager.wrapper;
        if (wrapper) {
            this.setupWrapper(wrapper);
        }
        this.sideEffectManager.add(() => {
            return internalEmitter.on("cursorMove", this.onCursorMove);
        });

        this.sideEffectManager.add(() => {
            return internalEmitter.on("playgroundSizeChange", () => this.updateContainerRect());
        });
        if (applianceIcons) {
            this.applianceIcons = { ...ApplianceMap, ...applianceIcons };
        }
    }

    private onCursorMove = (payload: CursorMovePayload) => {
        const cursorInstance = this.initCursorInstance(payload.uid);
        if (payload.state === CursorState.Leave) {
            cursorInstance.leave();
        } else {
            const member = cursorInstance.updateMember();
            if (this.canMoveCursor(member)) {
                cursorInstance.move(payload.position);
            }
        }
    };

    private initCursorInstance = (uid: string) => {
        let cursorInstance = this.cursorInstances.get(uid);
        if (!cursorInstance) {
            cursorInstance = new Cursor(this.manager, uid, this, WindowManager.wrapper);
            this.cursorInstances.set(uid, cursorInstance);
        }
        return cursorInstance;
    };

    private canMoveCursor(member: RoomMember | undefined) {
        const isLaserPointer =
            member?.memberState.currentApplianceName === ApplianceNames.laserPointer;
        // 激光笔教具在不开启光标的情况下也要显示
        return this.enableCursor || isLaserPointer;
    }

    public setupWrapper(wrapper: HTMLElement) {
        this.sideEffectManager.add(() => {
            wrapper.addEventListener("pointerenter", this.mouseMoveListener);
            wrapper.addEventListener("pointermove", this.mouseMoveListener);
            wrapper.addEventListener("pointerleave", this.mouseLeaveListener);
            return () => {
                wrapper.removeEventListener("pointerenter", this.mouseMoveListener);
                wrapper.removeEventListener("pointermove", this.mouseMoveListener);
                wrapper.removeEventListener("pointerleave", this.mouseLeaveListener);
            };
        });

        this.wrapperRect = wrapper.getBoundingClientRect();
    }

    public setMainViewDivElement(div: HTMLDivElement) {
        this.mainViewElement = div;
    }

    public get boxState() {
        return this.store.getBoxState();
    }

    public get focusView() {
        return this.manager.focusApp?.view;
    }

    private mouseMoveListener_ = (event: PointerEvent, isTouch: boolean) => {
        const type = this.getType(event);
        this.updateCursor(type, event.clientX, event.clientY);
        isTouch && this.showPencilEraserIfNeeded(type, event.clientX, event.clientY);
    }

    private mouseMoveTimer = 0;
    private mouseMoveListener = (event: PointerEvent) => {
        const isTouch = event.pointerType === "touch";
        if (isTouch && !event.isPrimary) return;

        const now = Date.now()
        if (now - this.mouseMoveTimer > 48) {
            this.mouseMoveTimer = now;
            this.mouseMoveListener_(event, isTouch);
        }
    }

    private mouseLeaveListener = () => {
        this.hideCursor(this.manager.uid);
    }

    private showPencilEraserIfNeeded(event: EventType, clientX: number, clientY: number) {
        const self = findMemberByUid(this.manager.room, this.manager.uid);
        const isPencilEraser = self?.memberState.currentApplianceName === ApplianceNames.pencilEraser;
        if (this.wrapperRect && this.manager.canOperate && this.canMoveCursor(self) && isPencilEraser) {
            const view = event.type === "main" ? this.manager.mainView : this.focusView;
            const point = this.getPoint(view, clientX, clientY);
            if (point) {
                this.onCursorMove({
                    uid: this.manager.uid,
                    position: {
                        x: point.x,
                        y: point.y,
                        type: event.type,
                    },
                });
            }
        }
    }

    private updateCursor(event: EventType, clientX: number, clientY: number) {
        const self = findMemberByUid(this.manager.room, this.manager.uid);
        if (this.wrapperRect && this.manager.canOperate && this.canMoveCursor(self)) {
            const view = event.type === "main" ? this.manager.mainView : this.focusView;
            const point = this.getPoint(view, clientX, clientY);
            if (point) {
                this.manager.dispatchInternalEvent(Events.CursorMove, {
                    uid: this.manager.uid,
                    position: {
                        x: point.x,
                        y: point.y,
                        type: event.type,
                    },
                } as CursorMovePayload);
            }
        }
    }

    private getPoint = (
        view: View | undefined,
        clientX: number,
        clientY: number
    ): Point | undefined => {
        const rect = view?.divElement?.getBoundingClientRect();
        if (rect) {
            const point = view?.convertToPointInWorld({
                x: clientX - rect.x,
                y: clientY - rect.y,
            });
            return point;
        }
    };

    /**
     *  因为窗口内框在不同分辨率下的大小不一样，所以这里通过来鼠标事件的 target 来判断是在主白板还是在 APP 中
     */
    private getType = (event: MouseEvent | Touch): EventType => {
        const target = event.target as HTMLElement;
        const focusApp = this.manager.focusApp;
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

    public updateContainerRect() {
        this.containerRect = WindowManager.container?.getBoundingClientRect();
        this.wrapperRect = WindowManager.wrapper?.getBoundingClientRect();
    }

    public deleteCursor(uid: string) {
        this.store.cleanCursor(uid);
        const cursor = this.cursorInstances.get(uid);
        if (cursor) {
            cursor.destroy();
        }
    }

    public hideCursor(uid: string) {
        const cursor = this.cursorInstances.get(uid);
        if (cursor) {
            cursor.hide();
        }
    }

    public destroy() {
        this.sideEffectManager.flushAll();
        if (this.cursorInstances.size) {
            this.cursorInstances.forEach(cursor => {
                cursor.destroy();
            });
            this.cursorInstances.clear();
        }
    }
}
