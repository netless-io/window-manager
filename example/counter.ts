import type { NetlessApp } from "../dist";
import { WindowManager } from "../dist/index.es";

export const Counter: NetlessApp = {
    kind: "Counter",
    setup: (context) => {
        const storage = context.storage;
        storage.ensureState({ count: 0 });

        const countDom = document.createElement("div");
        countDom.innerText = storage.state.count;
        context.getBox().$content.appendChild(countDom);

        storage.addStateChangedListener(diff => {
            if (diff.count) {
                countDom.innerText = diff.count.newValue;
            }
        });

        const incrementButton = document.createElement("button");
        incrementButton.innerText = "Increment";
        incrementButton.addEventListener("click", () => {
            storage.setState({ count: storage.state.count + 1 });
        });
        context.getBox().$content.appendChild(incrementButton);
    }
}

WindowManager.register({
    kind: "Counter",
    src: Counter,
});
