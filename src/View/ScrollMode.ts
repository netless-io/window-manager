import { SideEffectManager } from "side-effect-manager";
import { Val } from "value-enhancer";
import type { ReadonlyVal} from "value-enhancer";

export class ScrollMode {
    public readonly sideEffect = new SideEffectManager();

    private readonly _scrollTop$: Val<number>;
    public readonly _page$: ReadonlyVal<number>;

    constructor() {
        this._scrollTop$ = new Val(0);

        const page$ = new Val(0);
        this._page$ = page$;
    }
}
