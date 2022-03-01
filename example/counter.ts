import type { NetlessApp } from "../dist";
import { WindowManager } from "../dist/index.es";

export const Counter: NetlessApp<{ count: number }> = {
    kind: "Counter",
    setup: context => {
        const storage = context.storage;
        storage.ensureState({ count: 0 });

        const box = context.getBox(); // box 为这个应用打开的窗口
        const $content = box.$content; // 获取窗口的 content

        const countDom = document.createElement("div");
        countDom.innerText = storage.state.count.toString();
        $content.appendChild(countDom);

        storage.addStateChangedListener(diff => {
            if (diff.count) {
                countDom.innerText = diff.count.newValue.toString();
            }
        });

        const incButton = document.createElement("button");
        incButton.innerText = "Inc";
        const incButtonOnClick = () => {
            storage.setState({ count: storage.state.count + 1 });
        };
        incButton.addEventListener("click", incButtonOnClick);
        $content.appendChild(incButton);

        const decButton = document.createElement("button");
        decButton.innerText = "Dec";
        const decButtonOnClick = () => {
            storage.setState({ count: storage.state.count - 1 });
        };
        decButton.addEventListener("click", decButtonOnClick);

        $content.appendChild(decButton);

        const event1Disposer = context.addMagixEventListener(`${context.appId}_event1`, msg => {
            console.log("event1", msg);
        });

        // 应用销毁时, 注意清理掉监听器
        context.emitter.on("destroy", () => {
            incButton.removeEventListener("click", incButtonOnClick);
            decButton.removeEventListener("click", decButtonOnClick);
            event1Disposer();
        });
    },
};

WindowManager.register({
    kind: "Counter",
    src: Counter,
});
