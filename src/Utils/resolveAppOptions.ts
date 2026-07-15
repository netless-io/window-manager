export function resolveAppOptions(
    registeredOptions: any | (() => any),
    override: any
): any | (() => any) {
    if (override === undefined) {
        return registeredOptions;
    }
    return () => ({
        ...(typeof registeredOptions === "function" ? registeredOptions() : registeredOptions),
        ...override,
    });
}
