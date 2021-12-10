import { AppAttributes, Events } from "./constants";
import type { EmitterEvent } from "./index";
import type Emittery from "emittery";

export type BoxEventHandlerContext = {
    emitter: Emittery<EmitterEvent>;
    updateAppState: (appId: string, stateName: AppAttributes, state: any) => void;
    dispatchMagixEvent: (event: Events, payload: any) => void;
    safeSetAttributes: (attributes: any) => void;
    closeApp: (appId: string, error?: Error) => void;
};

export class BoxEventHandler {
    constructor(private context: BoxEventHandlerContext) {
        context.emitter.onAny(this.eventListener);
    }

    private eventListener = (event: keyof EmitterEvent, payload: any) => {
        switch (event) {
            case "move": {
                this.moveHandler(payload);
                break;
            }
            case "focus": {
                this.context.safeSetAttributes({ focus: payload.appId });
                break;
            }
            case "resize": {
                this.resizeHandler(payload);
                break;
            }
            case "close": {
                this.context.closeApp(payload.appId, payload.error);
                break;
            }
            case "boxStateChange": {
                this.context.dispatchMagixEvent(Events.AppBoxStateChange, payload);
                break;
            }
            default: {
                break;
            }
        }
    };

    private moveHandler = (payload: any) => {
        this.context.dispatchMagixEvent(Events.AppMove, payload);
        this.context.updateAppState(payload.appId, AppAttributes.Position, {
            x: payload.x,
            y: payload.y,
        });
    };

    private resizeHandler(payload: any) {
        if (payload.width && payload.height) {
            this.context.dispatchMagixEvent(Events.AppResize, payload);
            this.context.updateAppState(payload.appId, AppAttributes.Size, {
                width: payload.width,
                height: payload.height,
            });
        }
    }

    public destroy() {
        this.context.emitter.offAny(this.eventListener);
    }
}
