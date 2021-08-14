
export class AppCreateError extends Error {
    message = "app duplicate exists and cannot be created again";
}

export class AppNotRegisterError extends Error {
    constructor(kind: string) {
        super(`app ${kind} need register or provide src`);
    }
}

export class AppManagerNotInitError extends Error {
    message = "AppManager must be initialized";
}

export class WhiteWebSDKInvalidError extends Error {
    constructor(version: string) {
        super(`white-web-sdk version must large than ${version}`)
    }
}

export class ParamsInvalidError extends Error {
    message = "kind must be a valid string";
}
