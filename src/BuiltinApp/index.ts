import AppDocsViewer from '@netless/app-docs-viewer';
import AppMediaPlayer, { setOptions } from '@netless/app-media-player';
import { emitter, WindowManager } from "../index";

emitter.on("onCreated", () => {
    if (WindowManager.debug) {
        setOptions({ verbose: true });
    }
});

WindowManager.register({
    kind: AppDocsViewer.kind,
    src: AppDocsViewer,
});
WindowManager.register({
    kind: AppMediaPlayer.kind,
    src: AppMediaPlayer,
});

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: AppMediaPlayer.kind as string,
};
