import * as Debug from "debug";

export const debug = Debug.default;

export const log = debug("WindowManager");

debug.enable("WindowManager");
