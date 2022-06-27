
export type AppState = {
    id: string;
    focus?: boolean;
    SceneIndex?: number;
    draggable?: boolean;
    position?: {
        x: number;
        y: number;
    }
    ratio?: number;
    resizable?: boolean;
    size?: {
        width: number;
        height: number;
    }
    stageRatio?: number;
    visible?: boolean;
    zIndex?: number;
    maximized: boolean | null;
    minimized: boolean | null;
}
