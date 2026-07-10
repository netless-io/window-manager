import { WindowManager } from "./index";

const loadAppMediaPlayer = async () => {
    const mod = await import("@netless/app-media-player");
    if (WindowManager.debug) {
        mod.setOptions({ verbose: true });
    }
    return (mod.default || mod) as any;
};

const loadAppDocsViewer = async () => {
    const mod = await import("@netless/app-docs-viewer");
    return (mod.default || mod) as any;
};

const loadAppPresentation = async () => {
    const mod = await import("@netless/app-presentation");
    return (mod.default || mod) as any;
};

export const setupBuiltin = () => {
    WindowManager.register({
        kind: BuiltinApps.DocsViewer,
        src: loadAppDocsViewer,
    });
    WindowManager.register({
        kind: BuiltinApps.MediaPlayer,
        src: loadAppMediaPlayer,
    });
    WindowManager.register({
        kind: BuiltinApps.Presentation,
        src: loadAppPresentation,
        appOptions: {
            reScaleOnPageChange: true,
            debounceSync: true,
            useScrollbar: true,
        },
    });
};

export const BuiltinApps = {
    DocsViewer: "DocsViewer",
    MediaPlayer: "MediaPlayer",
    Presentation: "Presentation",
};
