const noop = () => {};

export const format = {
    printf: formatter => formatter,
};

export const loggers = {
    has: () => false,
    add: noop,
    get: () => ({
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
    }),
};

export default {
    format,
    loggers,
};
