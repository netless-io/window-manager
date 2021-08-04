import { Displayer } from 'white-web-sdk';
import { PluginEventKeys, PluginListenerKeys } from './constants';
import React from 'react';

export type Plugin = {
    kind: string;
    options: {
        width: number;
        height: number;

        minwidth?: number;
        minheight?: number;
        enableView?: boolean;
    };
    setup: (context: Context) => void;
    wrapper?: React.ReactNode;
};

export type Context = {
    displayer: Displayer;
    attributes: any;

    setAttributes: (attributes: any) => void;
    updateAttributes: (keys: string[], attributes: any) => void;
    on: (event: PluginListenerKeys, listener: () => void) => void;
    emit: (event: PluginEventKeys, payload?: any) => void;
    off: (event: string, listener: () => void) => void;
    once: (event: string, listener: () => any) => void;
};
