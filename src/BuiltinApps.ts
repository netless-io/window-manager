import AppDocsViewer from "@netless/app-docs-viewer";
import { WindowManager } from "./index";

const loadAppMediaPlayer = async () => {
    const mod = await import("@netless/app-media-player");
    if (WindowManager.debug) {
        mod.setOptions({ verbose: true });
    }
    return (mod.default || mod) as any;
};

export const setupBuiltin = () => {
    WindowManager.register({
        kind: AppDocsViewer.kind,
        src: AppDocsViewer,
    });
    WindowManager.register({
        kind: "MediaPlayer",
        src: loadAppMediaPlayer,
    });
};

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: "MediaPlayer" as string,
};
