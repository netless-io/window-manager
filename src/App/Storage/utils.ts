import { has } from "lodash";
import { genUID } from "side-effect-manager";
import type { AutoRefValue, ExtractRawValue, RefValue } from "./typings";

export const plainObjectKeys = Object.keys as <T>(o: T) => Array<Extract<keyof T, string>>;

export function isRef<TValue = unknown>(e: unknown): e is RefValue<TValue> {
  return Boolean(has(e, '__isRef'));
}

export function makeRef<TValue>(v: TValue): RefValue<TValue> {
  return { k: genUID(), v, __isRef: true };
}

export function makeAutoRef<TValue>(v: TValue): AutoRefValue<TValue> {
  return isRef<ExtractRawValue<TValue>>(v) ? v : makeRef(v as ExtractRawValue<TValue>);
}
