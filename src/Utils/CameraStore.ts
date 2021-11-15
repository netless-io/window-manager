import { AnimationMode } from "white-web-sdk";
import type { Camera, View } from "white-web-sdk";

export class CameraStore {
    private cameras: Map<string, Camera> = new Map();
    private listeners: Map<string, any> = new Map();

    public setCamera(id: string, camera: Camera) {
        this.cameras.set(id, camera);
    }

    public getCamera(id: string) {
        return this.cameras.get(id);
    }

    public deleteCamera(id: string) {
        this.cameras.delete(id);
    }

    public recoverCamera(id: string, view?: View) {
        const camera = this.cameras.get(id);
        if (camera && view) {
            view.moveCamera({
                ...camera,
                animationMode: AnimationMode.Immediately,
            });
        }
    }

    public register(id: string, view: View) {
        this.onListener(id, view);
        this.setCamera(id, view.camera);
    }

    public unregister(id: string, view?: View) {
        if (view) {
            this.offListener(id, view);
        }
        this.listeners.delete(id);
        this.deleteCamera(id);
    }

    private onListener = (id: string, view: View) => {
        view.callbacks.on("onCameraUpdated", this.getOrCreateListener(id));
    };

    private offListener = (id: string, view: View) => {
        view.callbacks.off("onCameraUpdated", this.getOrCreateListener(id));
    };

    public async switchView(id: string, view: View | undefined, callback: () => void) {
        if (view) {
            this.offListener(id, view);
            await callback();
            this.recoverCamera(id, view);
            this.onListener(id, view);
        }
    }

    private getOrCreateListener(id: string) {
        let listener = this.listeners.get(id);
        if (listener) {
            return listener;
        } else {
            listener = (camera: Camera) => {
                this.setCamera(id, camera);
            };
            this.listeners.set(id, listener);
            return listener;
        }
    }
}
