
export class AppCreateError extends Error {
    override message = "[WindowManager]: app duplicate exists and cannot be created again";
}

export class AppNotRegisterError extends Error {
    constructor(kind: string) {
        super(`[WindowManager]: app ${kind} need register or provide src`);
    }
}

export class AppManagerNotInitError extends Error {
    override message = "[WindowManager]: AppManager must be initialized";
}

export class WhiteWebSDKInvalidError extends Error {
    constructor(version: string) {
        super(`[WindowManager]: white-web-sdk version must large than ${version}`);
    }
}

export class ParamsInvalidError extends Error {
    override message = "[WindowManager]: kind must be a valid string";
}

export class BoxNotCreatedError extends Error {
    override message = "[WindowManager]: box need created";
}

export class InvalidScenePath extends Error {
    override message = `[WindowManager]: ScenePath should start with "/"`;
}

export class BoxManagerNotInitializeError extends Error {
    override message = "[WindowManager]: boxManager need initialize";
}

export class BindContainerRoomPhaseInvalidError extends Error {
    override message = "[WindowManager]: room phase only Connected can be bindContainer";
}

export class InvalidViewModeError extends Error {
    override message = "[WindowManager]: scroll mode cannot be switched to other viewMode";
}
