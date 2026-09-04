export type DocsEvent =
    | "prevPage"
    | "nextPage"
    | "prevStep"
    | "nextStep"
    | "jumpToPage"
    | "scalePage";

/** `mainView` or a concrete Slide/Presentation appId. */
export type DocsEventTarget = string;

export type DocsEventOptions = {
    target?: DocsEventTarget;
    /** @deprecated Use `target` instead. */
    appId?: string;
    /** 1-based page number. */
    page?: number;
    /** Scale relative to the fitted content size. `1` means fitted size. */
    scale?: number;
};

export type PageScaleRange = {
    /** Optional minimum scale relative to the fitted content size. */
    minScale?: number;
    /** Optional maximum scale relative to the fitted content size. */
    maxScale?: number;
};

export function normalizePageScaleRange(
    range: PageScaleRange | undefined
): Readonly<PageScaleRange> | undefined {
    if (range === undefined) return undefined;
    if (!range || typeof range !== "object" || Array.isArray(range)) {
        throw new Error("[WindowManager]: pageScaleRange must be an object");
    }
    const { minScale, maxScale } = range;
    if (minScale !== undefined && (!Number.isFinite(minScale) || minScale <= 0)) {
        throw new Error(
            "[WindowManager]: pageScaleRange.minScale must be a finite positive number"
        );
    }
    if (maxScale !== undefined && (!Number.isFinite(maxScale) || maxScale <= 0)) {
        throw new Error(
            "[WindowManager]: pageScaleRange.maxScale must be a finite positive number"
        );
    }
    if (minScale !== undefined && maxScale !== undefined && minScale > maxScale) {
        throw new Error("[WindowManager]: pageScaleRange.minScale must not exceed maxScale");
    }
    return { minScale, maxScale };
}

export type PageStateOptions = {
    target?: DocsEventTarget;
};

export type DispatchDocsEventFailureReason =
    | "invalidEvent"
    | "invalidOptions"
    | "targetNotFound"
    | "targetNotSupported"
    | "eventNotSupported"
    | "notWritable"
    | "stateUnavailable"
    | "outOfRange"
    | "commandFailed";

export type DispatchDocsEventResult =
    | { accepted: true }
    | {
          accepted: false;
          reason: DispatchDocsEventFailureReason;
          message: string;
      };

export type UnifiedPageState = {
    target: "mainView" | "DocsViewer" | "Slide" | "Presentation";
    appId?: string;
    page: number;
    pageCount: number;
    /** MainView/Slide/Presentation actual scale relative to fitted size. */
    scale?: number;
};

export type UnifiedPageStateObservation = UnifiedPageState & {
    /** `pending` means Slide's View and render sources do not agree yet. */
    status: "pending" | "success";
    /** Missing means a page change for compatibility with earlier versions. */
    changeType?: "page" | "scale";
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
    event: DocsEvent;
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
    getViewScale?: () => number | undefined;
    onScaleChanged?: (listener: (scale: number) => void) => void | (() => void);
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
    event: DocsEvent,
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
    private loggedSuccessStates = new Map<StateKey, UnifiedPageState>();
    private loggedErrorSignatures = new Map<StateKey, Set<string>>();
    private successLogTimers = new Map<StateKey, ReturnType<typeof setTimeout>>();
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
        this.loggedSuccessStates.delete(key);
        this.loggedErrorSignatures.delete(key);
        this.clearSuccessLogTimer(key);
    }

    public hasObservedPageChange(key: StateKey, state: UnifiedPageState): boolean {
        const previous = this.states.get(key);
        return Boolean(
            previous && (previous.page !== state.page || previous.pageCount !== state.pageCount)
        );
    }

    public emitObservedState(key: StateKey, state: UnifiedPageState, force = false): boolean {
        const previous = this.states.get(key);
        this.states.set(key, { ...state });
        return (
            force ||
            !previous ||
            previous.page !== state.page ||
            previous.pageCount !== state.pageCount ||
            !sameScale(previous.scale, state.scale)
        );
    }

    public shouldLogSuccessState(key: StateKey, state: UnifiedPageState): boolean {
        const previous = this.loggedSuccessStates.get(key);
        this.loggedSuccessStates.set(key, { ...state });
        return (
            !previous ||
            previous.page !== state.page ||
            previous.pageCount !== state.pageCount ||
            !sameScale(previous.scale, state.scale)
        );
    }

    public shouldLogError(key: StateKey, signature: string): boolean {
        const signatures = this.loggedErrorSignatures.get(key) || new Set<string>();
        if (signatures.has(signature)) return false;
        signatures.add(signature);
        this.loggedErrorSignatures.set(key, signatures);
        return true;
    }

    public clearLoggedError(key: StateKey): void {
        this.loggedErrorSignatures.delete(key);
    }

    public debounceSuccessLog(key: StateKey, callback: () => void, debounceTime: number): void {
        this.clearSuccessLogTimer(key);
        this.successLogTimers.set(
            key,
            setTimeout(() => {
                this.successLogTimers.delete(key);
                callback();
            }, debounceTime)
        );
    }

    private clearSuccessLogTimer(key: StateKey): void {
        const timer = this.successLogTimers.get(key);
        if (timer !== undefined) clearTimeout(timer);
        this.successLogTimers.delete(key);
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
        this.clearState(`app:${appId}`);
        this.lastSlideRenderPages.delete(appId);
    }

    public destroy(): void {
        for (const disposer of this.listenerDisposers.splice(0)) disposer();
        for (const disposers of this.appObserverDisposers.values()) {
            for (const disposer of disposers) disposer();
        }
        for (const disposer of this.slideObserverDisposers.values()) disposer();
        for (const timer of this.successLogTimers.values()) clearTimeout(timer);
        this.appObserverDisposers.clear();
        this.slideObserverDisposers.clear();
        this.successLogTimers.clear();
        this.states.clear();
        this.loggedSuccessStates.clear();
        this.loggedErrorSignatures.clear();
        this.lastSlideRenderPages.clear();
        this.listenersInstalled = false;
    }
}

function sameScale(left: number | undefined, right: number | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    return Math.abs(left - right) < 0.000001;
}
