import React from 'react';
import { PluginContext } from './PluginContext';

export type Plugin = {
    kind: string;
    config: {
        width: number;
        height: number;

        minwidth?: number;
        minheight?: number;
        enableView?: boolean;
    };
    setup: (context: PluginContext) => void;
    wrapper?: React.ReactNode;
};

export { PluginContext } from "./PluginContext";
