import AppDocsViewer from "@netless/app-docs-viewer";
import AppMediaPlayer from "@netless/app-media-player";
import { WindowManager } from "./index";

export const setupBuiltin = () => {
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

export const BuiltinAppsMap = {
    [BuiltinApps.DocsViewer]: AppDocsViewer,
    [BuiltinApps.MediaPlayer]: AppMediaPlayer,
}
