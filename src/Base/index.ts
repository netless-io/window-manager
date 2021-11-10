import type { AppManager } from "../AppManager";
import { AttributesDelegate } from "../AttributesDelegate";

export class Base {
    public store = new AttributesDelegate(this.manager);
    constructor(public manager: AppManager) {}
}
