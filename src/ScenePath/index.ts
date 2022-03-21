import type { ScenesCallbacks, ScenesCallbacksNode } from "white-web-sdk";
import type { AppManager } from "../AppManager";

export class ScenesCallbackManager {
    
    private nodes: Map<string, ScenesCallbacksNode> = new Map();

    constructor(private manager: AppManager) {}

    public createNode(path: string, callbacks?: Partial<ScenesCallbacks>): ScenesCallbacksNode | null {
        const node = this.manager.displayer.createScenesCallback(path, callbacks);
        if (node) {
            this.nodes.set(path, node);
        }
        return node;
    }

    public getScenes(path: string) {
        const node = this.nodes.get(path);
        return node?.scenes;
    }

    public getScenesOnce(path: string) {
        let node = this.nodes.get(path);
        if (!node) {
            const created = this.createNode(path);
            if (created) {
                node = created;
            }
        }
        const scenes = node?.scenes;
        this.removeNode(path);
        return scenes;
    }

    public removeNode(path: string) {
        const node = this.nodes.get(path);
        if (node) {
            node.dispose();
            this.nodes.delete(path);
        }
    }

    public destroy(): void {
        this.nodes.forEach(node => node.dispose());
    }
}
