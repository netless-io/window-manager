import { Camera } from "white-web-sdk";

export class ViewCameraManager {
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
}