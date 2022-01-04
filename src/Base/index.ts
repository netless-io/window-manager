import type { AppManager } from "../AppManager";
import { store } from "../AttributesDelegate";
import { createContext } from "./Context";

export class Base {
    public store = store;
    public context = createContext(this.manager);

    constructor(public manager: AppManager) {}
}
