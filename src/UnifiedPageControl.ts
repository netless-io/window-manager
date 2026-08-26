export type PageEvent = "prevPage" | "nextPage" | "prevStep" | "nextStep" | "jumpToPage";

/** `mainView` or a concrete Slide/Presentation appId. */
export type PageEventTarget = string;

export type PageEventOptions = {
    target?: PageEventTarget;
    /** 1-based page number. */
    page?: number;
};

export type PageStateOptions = {
    target?: PageEventTarget;
};

export type UnifiedPageState = {
    target: "mainView" | "Slide" | "Presentation";
    appId?: string;
    page: number;
    pageCount: number;
};

export type UnifiedPageStateObservation = UnifiedPageState & {
    /** `pending` means Slide's View and render sources do not agree yet. */
    status: "pending" | "success";
    /** MainView-only: current 1-based page. */
    mainView?: number;
    /** Presentation-only: current 1-based page. */
    presentation?: number;
    /** Slide-only: 1-based page parsed from the Whiteboard View scenePath. */
    view?: number;
    /** Slide-only: latest 1-based renderEnd page. */
    slide?: number;
};

export type UnifiedPageStateFailure = UnifiedPageState & {
    status: "failure";
    event: PageEvent;
    reason: "commandFailed";
    message?: string;
};

export type UnifiedPageStateChange = UnifiedPageStateObservation | UnifiedPageStateFailure;

export type SlidePageController = {
    prevPage: () => boolean;
    nextPage: () => boolean;
    prevStep: () => boolean;
    nextStep: () => boolean;
    jumpToPage: (page: number) => boolean;
    scaleView: (scale: number) => void;
};

export type PresentationPageController = {
    prevPage: () => boolean;
    nextPage: () => boolean;
    jumpPage: (index: number) => boolean;
    /** Optional completion-aware methods used only by the unified async API. */
    prevPageAsync?: () => Promise<boolean>;
    nextPageAsync?: () => Promise<boolean>;
    jumpPageAsync?: (index: number) => Promise<boolean>;
    pageState: () => { index: number; length: number };
    moveCamera: (camera: { centerX: number; centerY: number; scale: number }) => void;
    getOriginScale: () => number;
};

export function executeAppPageCommand(
    appKind: "Slide" | "Presentation",
    controller: SlidePageController | PresentationPageController,
    event: PageEvent,
    page?: number,
    preferAsyncPresentation = false
): boolean | Promise<boolean> {
    if (appKind === "Presentation") {
        const presentation = controller as PresentationPageController;
        if (preferAsyncPresentation) {
            if (event === "prevPage" && presentation.prevPageAsync) {
                return presentation.prevPageAsync();
            }
            if (event === "nextPage" && presentation.nextPageAsync) {
                return presentation.nextPageAsync();
            }
            if (event === "jumpToPage" && page !== undefined && presentation.jumpPageAsync) {
                return presentation.jumpPageAsync(page - 1);
            }
        }
        if (event === "prevPage") return presentation.prevPage();
        if (event === "nextPage") return presentation.nextPage();
        if (event === "jumpToPage" && page !== undefined) return presentation.jumpPage(page - 1);
        return false;
    }
    const slide = controller as SlidePageController;
    if (event === "prevPage") return slide.prevPage();
    if (event === "nextPage") return slide.nextPage();
    if (event === "prevStep") return slide.prevStep();
    if (event === "nextStep") return slide.nextStep();
    if (event === "jumpToPage" && page !== undefined) return slide.jumpToPage(page);
    return false;
}

type StateKey = string;

/** Stores only observed state and listener cleanup for unified page events. */
export class UnifiedPageControlTracker {
    private states = new Map<StateKey, UnifiedPageState>();
    private slideObserverDisposers = new Map<string, () => void>();
    private lastSlideRenderPages = new Map<string, number>();
    private appObserverDisposers = new Map<string, Array<() => void>>();
    private listenerDisposers: Array<() => void> = [];
    private listenersInstalled = false;

    public get isListenersInstalled(): boolean {
        return this.listenersInstalled;
    }

    public markListenersInstalled(): void {
        this.listenersInstalled = true;
    }

    public addListenerDisposer(disposer: () => void): void {
        this.listenerDisposers.push(disposer);
    }

    public clearState(key: StateKey): void {
        this.states.delete(key);
    }

    public emitObservedState(key: StateKey, state: UnifiedPageState, force = false): boolean {
        const previous = this.states.get(key);
        this.states.set(key, { ...state });
        return (
            force ||
            !previous ||
            previous.page !== state.page ||
            previous.pageCount !== state.pageCount
        );
    }

    public setSlideObserverDisposer(appId: string, disposer: () => void): void {
        this.slideObserverDisposers.get(appId)?.();
        this.slideObserverDisposers.set(appId, disposer);
    }

    public hasSlideObserverDisposer(appId: string): boolean {
        return this.slideObserverDisposers.has(appId);
    }

    public clearSlideObserverDisposer(appId: string): void {
        this.slideObserverDisposers.get(appId)?.();
        this.slideObserverDisposers.delete(appId);
    }

    public setLastSlideRenderPage(appId: string, page: number): void {
        this.lastSlideRenderPages.set(appId, page);
    }

    public getLastSlideRenderPage(appId: string): number | undefined {
        return this.lastSlideRenderPages.get(appId);
    }

    public hasAppObserver(appId: string): boolean {
        return this.appObserverDisposers.has(appId);
    }

    public setAppObserverDisposers(appId: string, disposers: Array<() => void>): void {
        this.clearAppObserverDisposers(appId);
        this.appObserverDisposers.set(appId, disposers);
    }

    public clearAppObserverDisposers(appId: string): void {
        const disposers = this.appObserverDisposers.get(appId);
        this.appObserverDisposers.delete(appId);
        for (const disposer of disposers || []) disposer();
    }

    public clearApp(appId: string): void {
        this.clearSlideObserverDisposer(appId);
        this.clearAppObserverDisposers(appId);
        this.states.delete(`app:${appId}`);
        this.lastSlideRenderPages.delete(appId);
    }

    public destroy(): void {
        for (const disposer of this.listenerDisposers.splice(0)) disposer();
        for (const disposers of this.appObserverDisposers.values()) {
            for (const disposer of disposers) disposer();
        }
        for (const disposer of this.slideObserverDisposers.values()) disposer();
        this.appObserverDisposers.clear();
        this.slideObserverDisposers.clear();
        this.states.clear();
        this.lastSlideRenderPages.clear();
        this.listenersInstalled = false;
    }
}
