import type { AppManager } from "../AppManager";
import { createContext } from "./Context";

export class Base {
    public store = this.manager.store;
    public context = createContext(this.manager);

    constructor(public manager: AppManager) {}
}
