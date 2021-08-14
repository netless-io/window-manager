
export class AppCreateError extends Error {
    message = "app already exists and cannot be created again";
}

export class AppManagerNotInitError extends Error {
    message = "AppManager must be initialized";
}
