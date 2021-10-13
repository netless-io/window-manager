import type { Camera, View } from "white-web-sdk";
import { AnimationMode } from "white-web-sdk";

export class CameraStore {
    private cameras: Map<string, Camera> = new Map();

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
}
