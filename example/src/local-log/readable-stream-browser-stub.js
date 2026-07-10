export class Readable {
    constructor() {}

    on() {
        return this;
    }

    emit() {
        return false;
    }

    push() {
        return true;
    }
}

export default { Readable };
