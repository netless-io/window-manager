import AppDocsViewer from "@netless/app-docs-viewer";
import Plyr from "@netless/app-plyr";
import { WindowManager } from "./index";

export const setupBuiltin = () => {
    WindowManager.register({
        kind: AppDocsViewer.kind,
        src: AppDocsViewer,
    });
    WindowManager.register({
        kind: Plyr.kind,
        src: Plyr,
    });
};

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: Plyr.kind as string,
};

export const BuiltinAppsMap = {
    [BuiltinApps.DocsViewer]: AppDocsViewer,
    [BuiltinApps.MediaPlayer]: Plyr,
}
