import type { MountParams } from "../index";

// Keep merge semantics aligned with white-web-sdk dynamicConfig/Parameters.ts.
const forbidden = ["__proto__", "prototype", "constructor"];
export function isPlainObject(value: unknown): value is Record<string, any> {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    );
}
// Private, non-enumerable provenance shared with Bridge/Fastboard. Never part of OSS JSON.
const parameterLayersKey = "__netlessDynamicConfigLayers";
function cloneParameterValue(value: any): any {
    if (Array.isArray(value)) return value.map(cloneParameterValue);
    if (!isPlainObject(value)) return value;
    const copy: Record<string, any> = {};
    Object.keys(value).forEach(key => {
        if (forbidden.indexOf(key) === -1) copy[key] = cloneParameterValue(value[key]);
    });
    return copy;
}
/** Local undefined inherits. Arrays/instances are atomic; local hotKeys/floatBar retain their atomic API semantics. */
export function mergeDynamicParameters<T extends Record<string, any>>(
    remote: unknown,
    local: T,
    onOverride?: (path: string) => void,
    prefix = "",
    remoteEvidence?: { readonly value: unknown }
): T {
    const descriptor = Object.getOwnPropertyDescriptor(local, parameterLayersKey);
    const layers = descriptor && !descriptor.enumerable ? descriptor.value : undefined;
    if (
        layers &&
        layers.version === 1 &&
        isPlainObject(layers.defaults) &&
        isPlainObject(layers.explicit)
    ) {
        const inherited = mergeDynamicParameters(
            layers.defaults,
            isPlainObject(remote) ? remote : {}
        );
        return mergeDynamicParameters(inherited, layers.explicit, onOverride, prefix, {
            value: remote,
        }) as T;
    }
    if (!isPlainObject(remote)) return local;
    const output: Record<string, any> = cloneParameterValue(remote);
    Object.keys(local).forEach(key => {
        if (forbidden.indexOf(key) !== -1) return;
        const value = (local as Record<string, any>)[key];
        if (value === undefined) return;
        const path = prefix ? `${prefix}.${key}` : key;
        if (
            key !== "hotKeys" &&
            key !== "floatBar" &&
            isPlainObject(value) &&
            isPlainObject(output[key])
        ) {
            // Follow actual keys: version keys such as "122.0" must not be split as paths.
            const childEvidence = remoteEvidence
                ? {
                      value:
                          isPlainObject(remoteEvidence.value) &&
                          Object.prototype.hasOwnProperty.call(remoteEvidence.value, key)
                              ? remoteEvidence.value[key]
                              : undefined,
                  }
                : undefined;
            output[key] = mergeDynamicParameters(
                output[key],
                value,
                onOverride,
                path,
                childEvidence
            );
        } else {
            if (
                Object.prototype.hasOwnProperty.call(remote, key) &&
                (!remoteEvidence ||
                    (isPlainObject(remoteEvidence.value) &&
                        Object.prototype.hasOwnProperty.call(remoteEvidence.value, key)))
            ) {
                onOverride?.(path);
            }
            output[key] = value;
        }
    });
    return output as T;
}

export function applyDynamicMountParams(
    params: MountParams,
    liveRoom: boolean,
    onOverride?: (path: string) => void
): MountParams {
    if (!liveRoom) return params;
    const snapshot = (
        params.room as typeof params.room & { dynamicConfig?: { windowManager?: unknown } }
    ).dynamicConfig;
    const settings = snapshot?.windowManager;
    if (!isPlainObject(settings)) return params;
    const remote = { ...settings };
    // DOM nodes and the room reference are always provided by the local caller.
    ["room", "container", "collectorContainer"].forEach(key => delete remote[key]);
    return mergeDynamicParameters(remote, params, onOverride, "windowManager");
}
