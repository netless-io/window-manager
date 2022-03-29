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
    addPage: (params?: AddPageParams) => Promise<void>;
    pageState: PageState;
}
