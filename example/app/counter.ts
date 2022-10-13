import type { NetlessApp } from "../../dist";
import { WindowManager } from "../../dist/index.es";

export const Counter: NetlessApp<{ count: number }> = {
    kind: "Counter",
    setup: context => {
        const storage = context.storage;
        // 初始化值，只会在相应的 key 不存在 storage.state 的时候设置值
        storage.ensureState({ count: 0 });

        const box = context.getBox(); // box 为这个应用打开的窗口
        const $content = box.$content; // 获取窗口的 content

        const countDom = document.createElement("div");
        countDom.innerText = storage.state.count.toString();
        $content.appendChild(countDom);

        // 监听 state 的修改, 自己和其他人的修改都会触发这个回调
        storage.addStateChangedListener(diff => {
            if (diff.count) {
                countDom.innerText = diff.count.newValue.toString();
            }
        });

        const incButton = document.createElement("button");
        incButton.innerText = "Inc";
        const incButtonOnClick = () => {
            // 直接设值合并到 state，类似 React.setState
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

        // 监听事件
        const event1Disposer = context.addMagixEventListener("event1", msg => {
            console.log("event1", msg);
        });

        // 向打开 app 的其他人发送消息
        context.dispatchMagixEvent("event1", { count: 10 });

        // 应用销毁时, 注意清理掉监听器
        context.emitter.on("destroy", () => {
            incButton.removeEventListener("click", incButtonOnClick);
            decButton.removeEventListener("click", decButtonOnClick);
            event1Disposer();
        });

        return storage;
    },
};

WindowManager.register({
    kind: "Counter",
    src: Counter,
});
