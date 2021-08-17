
export class AppCreateError extends Error {
    message = "[WindowManager]: app duplicate exists and cannot be created again";
}

export class AppNotRegisterError extends Error {
    constructor(kind: string) {
        super(`[WindowManager]: app ${kind} need register or provide src`);
    }
}

export class AppManagerNotInitError extends Error {
    message = "[WindowManager]: AppManager must be initialized";
}

export class WhiteWebSDKInvalidError extends Error {
    constructor(version: string) {
        super(`[WindowManager]: white-web-sdk version must large than ${version}`)
    }
}

export class ParamsInvalidError extends Error {
    message = "[WindowManager]: kind must be a valid string";
}
