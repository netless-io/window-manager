export default class WinstonTransportBrowserStub {
    constructor(options = {}) {
        Object.assign(this, options);
    }

    log(_info, callback) {
        if (typeof callback === "function") {
            callback();
        }
    }
}
