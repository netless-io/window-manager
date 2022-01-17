import AppDocsViewer from "@netless/app-docs-viewer";
import AppMediaPlayer, { setOptions } from "@netless/app-media-player";
import { WindowManager } from "./index";

export const setupBuiltin = () => {
    if (WindowManager.debug) {
        setOptions({ verbose: true });
    }

    WindowManager.register({
        kind: AppDocsViewer.kind,
        src: AppDocsViewer,
    });
    WindowManager.register({
        kind: AppMediaPlayer.kind,
        src: AppMediaPlayer,
    });
};

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: AppMediaPlayer.kind as string,
};
