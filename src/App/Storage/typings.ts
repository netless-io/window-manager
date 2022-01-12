import type { StorageEventListener } from "./StorageEvent";

export type RefValue<TValue = any> = { k: string; v: TValue; __isRef: true };

export type ExtractRawValue<TValue> = TValue extends RefValue<infer TRefValue> ? TRefValue : TValue;

export type AutoRefValue<TValue> = RefValue<ExtractRawValue<TValue>>;

export type MaybeRefValue<TValue> = TValue | AutoRefValue<TValue>;

export type DiffOne<T> = { oldValue?: T; newValue?: T };

export type Diff<T> = { [K in keyof T]?: DiffOne<T[K]> };

export type StorageOnSetStatePayload<TState = unknown> = {
  [K in keyof TState]?: MaybeRefValue<TState[K]>;
};

export type StorageStateChangedEvent<TState = any> = Diff<TState>;

export type StorageStateChangedListener<TState = any> = StorageEventListener<StorageStateChangedEvent<TState>>;

export type StorageStateChangedListenerDisposer = () => void;
