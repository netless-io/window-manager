import type { SceneDefinition } from "white-web-sdk";

export type AddPageParams = {
    after?: boolean;
    scene?: SceneDefinition;
};

export type PageState = {
    index: number;
    length: number;
};

export interface PageController {
    nextPage: () => Promise<boolean>;
    prevPage: () => Promise<boolean>;
    jumpPage: (index: number) => Promise<boolean>;
    addPage: (params?: AddPageParams) => Promise<void>;
    removePage: (index: number) => Promise<boolean>;
    pageState: PageState;
}

export interface PageRemoveService {
    removeSceneByIndex: (index: number) => Promise<boolean>;
    setSceneIndexWithoutSync: (index: number) => void;
}
