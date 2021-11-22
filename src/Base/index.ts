import type { AppManager } from "../AppManager";
import { AttributesDelegate } from "../AttributesDelegate";
import { createContext } from "./Context";

export class Base {
    public store = new AttributesDelegate(this.manager);
    public context = createContext(this.manager);

    constructor(public manager: AppManager) {}
}
