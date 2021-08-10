import { Camera } from "white-web-sdk";
import { WindowManager } from ".";

export class ViewCameraManager {
    private cameras: Map<string, Camera> = new Map();

    constructor(
        private manager: WindowManager
    ) {}

    public setCamera(id: string, camera: Camera) {
        this.cameras.set(id, camera);
    }

    public getCamera(id: string) {
        return this.cameras.get(id);
    }

    public deleteCamera(id: string) {
        this.cameras.delete(id);
    }
}