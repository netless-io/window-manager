import { SceneState } from 'white-web-sdk';
import { PluginContext } from './PluginContext';

export interface Plugin<T = any> {
    kind: string;
    config: {
        width: number;
        height: number;

        minwidth?: number;
        minheight?: number;
        enableView?: boolean;
    };
    setup: (context: PluginContext<T>) => void;
};

export type PluginEmitterEvent<T = any> = {
    create: void,
    destroy: { error?: Error },
    attributesUpdate: T,
    writableChange: boolean,
    sceneStateChange: SceneState,
}

export type PluginListenerKeys = keyof PluginEmitterEvent;

export { PluginContext } from "./PluginContext";
