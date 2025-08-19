import type { AkkoObjectUpdatedProperty } from "white-web-sdk";
import type { AppContext } from "../AppContext";
import type {
    Diff,
    MaybeRefValue,
    RefValue,
    StorageStateChangedEvent,
    StorageStateChangedListener,
    StorageStateChangedListenerDisposer,
} from "./typings";

import { get, has, isObject, mapValues, noop, size } from "lodash";
import { SideEffectManager } from "side-effect-manager";
import { safeListenPropsUpdated } from "../../Utils/Reactive";
import { StorageEvent } from "./StorageEvent";
import { isRef, makeRef, plainObjectKeys } from "./utils";

export * from "./typings";

export const STORAGE_NS = "_WM-STORAGE_";

export class Storage<TState extends Record<string, any> = any> implements Storage<TState> {
    readonly id: string | null;
    readonly maxIllusionQueueSize = 500;

    private readonly _context: AppContext;
    private readonly _sideEffect = new SideEffectManager();
    private _state: TState;
    private _destroyed = false;

    private _refMap = new WeakMap<any, RefValue>();

    /**
     * `setState` alters local state immediately before sending to server. This will cache the old value for onStateChanged diffing.
     */
    private _lastValue = new Map<string | number | symbol, TState[Extract<keyof TState, string>]>();

    constructor(context: AppContext, id?: string, defaultState?: TState) {
        if (defaultState && !isObject(defaultState)) {
            throw new Error(`Default state for Storage ${id} is not an object.`);
        }

        this._context = context;
        this.id = id || null;

        this._state = {} as TState;
        const rawState = this._getRawState(this._state);

        if (this._context.getIsWritable()) {
            if (this.id === null) {
                if (context.isAddApp && defaultState) {
                    this.setState(defaultState);
                }
            } else {
                if (rawState === this._state || !isObject(rawState)) {
                    if (!get(this._context.getAttributes(), [STORAGE_NS])) {
                        this._context.updateAttributes([STORAGE_NS], {});
                    }
                    this._context.updateAttributes([STORAGE_NS, this.id], this._state);
                    if (defaultState) {
                        this.setState(defaultState);
                    }
                }
            }
        }

        // strip mobx
        plainObjectKeys(rawState).forEach(key => {
            if (this.id === null && key === STORAGE_NS) {
                return;
            }
            try {
                const rawValue = isObject(rawState[key])
                    ? JSON.parse(JSON.stringify(rawState[key]))
                    : rawState[key];
                if (isRef<TState[Extract<keyof TState, string>]>(rawValue)) {
                    this._state[key] = rawValue.v;
                    if (isObject(rawValue.v)) {
                        this._refMap.set(rawValue.v, rawValue);
                    }
                } else {
                    this._state[key] = rawValue;
                }
            } catch (e) {
                console.error(e);
            }
        });

        this._sideEffect.addDisposer(
            safeListenPropsUpdated(
                () =>
                    this.id === null
                        ? context.getAttributes()
                        : get(context.getAttributes(), [STORAGE_NS, this.id]),
                this._updateProperties.bind(this),
                this.destroy.bind(this)
            )
        );
    }

    get state(): Readonly<TState> {
        if (this._destroyed) {
            console.warn(`Accessing state on destroyed Storage "${this.id}"`);
        }
        return this._state;
    }

    readonly onStateChanged = new StorageEvent<StorageStateChangedEvent<TState>>();

    addStateChangedListener(
        handler: StorageStateChangedListener<TState>
    ): StorageStateChangedListenerDisposer {
        this.onStateChanged.addListener(handler);
        return () => this.onStateChanged.removeListener(handler);
    }

    ensureState(state: Partial<TState>): void {
        return this.setState(
            plainObjectKeys(state).reduce((payload, key) => {
                if (!has(this._state, key)) {
                    payload[key] = state[key];
                }
                return payload;
            }, {} as Partial<TState>)
        );
    }

    setState(state: Partial<TState>): void {
        if (this._destroyed) {
            console.error(new Error(`Cannot call setState on destroyed Storage "${this.id}".`));
            return;
        }

        if (!this._context.getIsWritable()) {
            console.error(
                new Error(`Cannot setState on Storage "${this.id}" without writable access`),
                state
            );
            return;
        }

        const keys = plainObjectKeys(state);
        if (keys.length > 0) {
            keys.forEach(key => {
                const value = state[key];
                if (value === this._state[key]) {
                    return;
                }

                if (value === void 0) {
                    this._lastValue.set(key, this._state[key]);
                    delete this._state[key];
                    this._setRawState(key, value);
                } else {
                    this._lastValue.set(key, this._state[key]);
                    this._state[key] = value as TState[Extract<keyof TState, string>];

                    let payload: MaybeRefValue<typeof value> = value;
                    if (isObject(value)) {
                        let refValue = this._refMap.get(value);
                        if (!refValue) {
                            refValue = makeRef(value);
                            this._refMap.set(value, refValue);
                        }
                        payload = refValue;
                    }

                    this._setRawState(key, payload);
                }
            });
        }
    }

    /**
     * Empty storage data.
     */
    emptyStorage(): void {
        if (size(this._state) <= 0) {
            return;
        }

        if (this._destroyed) {
            console.error(new Error(`Cannot empty destroyed Storage "${this.id}".`));
            return;
        }

        if (!this._context.getIsWritable()) {
            console.error(new Error(`Cannot empty Storage "${this.id}" without writable access.`));
            return;
        }

        this.setState(mapValues(this._state, noop as () => undefined));
    }

    /**
     * Delete storage index with all of its data and destroy the Storage instance.
     */
    deleteStorage(): void {
        if (this.id === null) {
            throw new Error(`Cannot delete main Storage`);
        }

        if (!this._context.getIsWritable()) {
            console.error(new Error(`Cannot delete Storage "${this.id}" without writable access.`));
            return;
        }

        this.destroy();

        this._context.updateAttributes([STORAGE_NS, this.id], void 0);
    }

    get destroyed(): boolean {
        return this._destroyed;
    }

    /**
     * Destroy the Storage instance. The data will be kept.
     */
    destroy() {
        this._destroyed = true;
        this._sideEffect.flushAll();
    }

    private _getRawState(): TState | undefined;
    private _getRawState(defaultValue: TState): TState;
    private _getRawState(defaultValue?: TState): TState | undefined {
        if (this.id === null) {
            return this._context.getAttributes() ?? defaultValue;
        } else {
            return get(this._context.getAttributes(), [STORAGE_NS, this.id], defaultValue);
        }
    }

    private _setRawState(key: string, value: any): void {
        if (this.id === null) {
            if (key === STORAGE_NS) {
                throw new Error(`Cannot set attribute internal filed "${STORAGE_NS}"`);
            }
            return this._context.updateAttributes([key], value);
        } else {
            return this._context.updateAttributes([STORAGE_NS, this.id, key], value);
        }
    }

    private _updateProperties(
        actions: ReadonlyArray<AkkoObjectUpdatedProperty<TState, string>>
    ): void {
        if (this._destroyed) {
            console.error(
                new Error(`Cannot call _updateProperties on destroyed Storage "${this.id}".`)
            );
            return;
        }

        if (actions.length > 0) {
            const diffs: Diff<TState> = {};

            for (let i = 0; i < actions.length; i++) {
                try {
                    const action = actions[i];
                    const key = action.key as Extract<keyof TState, string>;

                    if (this.id === null && key === STORAGE_NS) {
                        continue;
                    }

                    const value = isObject(action.value)
                        ? JSON.parse(JSON.stringify(action.value))
                        : action.value;
                    let oldValue: TState[Extract<keyof TState, string>] | undefined;
                    if (this._lastValue.has(key)) {
                        oldValue = this._lastValue.get(key);
                        this._lastValue.delete(key);
                    }

                    switch (action.kind) {
                        case 2: {
                            // Removed
                            if (has(this._state, key)) {
                                oldValue = this._state[key];
                                delete this._state[key];
                            }
                            diffs[key] = { oldValue };
                            break;
                        }
                        default: {
                            let newValue = value;

                            if (isRef<TState[Extract<keyof TState, string>]>(value)) {
                                const { k, v } = value;
                                const curValue = this._state[key];
                                if (isObject(curValue) && this._refMap.get(curValue)?.k === k) {
                                    newValue = curValue;
                                } else {
                                    newValue = v;
                                    if (isObject(v)) {
                                        this._refMap.set(v, value);
                                    }
                                }
                            }

                            if (newValue !== this._state[key]) {
                                oldValue = this._state[key];
                                this._state[key] = newValue;
                            }

                            diffs[key] = { newValue, oldValue };
                            break;
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            }

            this.onStateChanged.dispatch(diffs);
        }
    }
}
