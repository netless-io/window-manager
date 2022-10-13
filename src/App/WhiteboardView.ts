import { putScenes } from "../Utils/Common";
import { Val } from "value-enhancer";
import { pick } from "lodash";

import type { ReadonlyVal } from "value-enhancer";
import type { AddPageParams, PageController, PageState } from "../Page";
import type { AppProxy } from "./AppProxy";
import type { AppContext } from "./AppContext";
import type { Camera, View } from "white-web-sdk";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { ICamera, ISize } from "../AttributesDelegate";

export type WhiteBoardViewCamera = Omit<ICamera, "id">;
export type WhiteBoardViewRect = Omit<ISize, "id">;

export class WhiteBoardView implements PageController {
    public readonly pageState$: ReadonlyVal<PageState>;
    public readonly camera$: ReadonlyVal<WhiteBoardViewCamera>;
    public readonly baseRect$: ReadonlyVal<WhiteBoardViewRect | undefined>;

    constructor(
        public view: View,
        protected appContext: AppContext,
        protected appProxy: AppProxy,
        public ensureSize: (size: number) => void
    ) {
        const pageState$ = new Val<PageState>(appProxy.pageState);
        const baseRect$ = new Val<WhiteBoardViewRect | undefined>(appProxy.size$.value);
        const pickCamera = (camera: Camera | ICamera) =>
            pick(camera, ["centerX", "centerY", "scale"]);
        const camera$ = new Val<WhiteBoardViewCamera>(pickCamera(this.view.camera));
        this.baseRect$ = baseRect$;
        this.pageState$ = pageState$;
        this.camera$ = camera$;
        this.appProxy.sideEffectManager.add(() => [
            appProxy.appEmitter.on("pageStateChange", pageState => pageState$.setValue(pageState)),
            appProxy.camera$.subscribe(camera => {
                if (camera) {
                    camera$.setValue(pickCamera(camera));
                }
            }),
            appProxy.size$.subscribe(size => {
                if (size) {
                    baseRect$.setValue(pick(size, ["width", "height"]));
                }
            }),
        ]);
        view.disableCameraTransform = true;
    }

    public get pageState() {
        return this.pageState$.value;
    }

    public moveCamera(camera: Partial<WhiteBoardViewCamera>) {
        this.appProxy.moveCamera(camera);
    }

    public nextPage = async (): Promise<boolean> => {
        const nextIndex = this.pageState.index + 1;
        return this.jumpPage(nextIndex);
    };

    public prevPage = async (): Promise<boolean> => {
        const nextIndex = this.pageState.index - 1;
        return this.jumpPage(nextIndex);
    };

    public jumpPage = async (index: number): Promise<boolean> => {
        if (index < 0 || index >= this.pageState.length) {
            console.warn(`[WindowManager]: index ${index} out of range`);
            return false;
        }
        this.appProxy.setSceneIndex(index);
        return true;
    };

    public addPage = async (params?: AddPageParams) => {
        const after = params?.after;
        const scene = params?.scene;
        const scenePath = this.appProxy.scenePath;
        if (!scenePath) return;
        const scenes = Array.isArray(scene) ? scene : [scene || {}];
        if (after) {
            const nextIndex = this.pageState.index + 1;
            putScenes(this.appContext.room, scenePath, scenes, nextIndex);
        } else {
            putScenes(this.appContext.room, scenePath, scenes);
        }
    };

    public removePage = async (index?: number): Promise<boolean> => {
        const needRemoveIndex = index === undefined ? this.pageState.index : index;
        if (this.pageState.length === 1) {
            console.warn(`[WindowManager]: can not remove the last page`);
            return false;
        }
        if (needRemoveIndex < 0 || needRemoveIndex >= this.pageState.length) {
            console.warn(`[WindowManager]: page index ${index} out of range`);
            return false;
        }
        return this.appProxy.removeSceneByIndex(needRemoveIndex);
    };

    public setBaseRect(rect: Omit<TeleBoxRect, "x" | "y">) {
        this.appProxy.updateSize(rect.width, rect.height);
    }
}
