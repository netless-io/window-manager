import type { NetlessApp } from "../../dist";
import React, { useEffect, useState } from "react";
import ReactDom from "react-dom";
import type { AppContext } from "../../dist";
import "./board.css";

export const Board: NetlessApp = {
    kind: "Board",
    setup: context => {
        // 获取 app 的 box
        const box = context.getBox();

        // 挂载白板的 view 到 box 到 content
        context.mountView(box.$content);

        // 挂载自定义的 footer 到 box 的 footer 上
        mount(box.$footer, context);

        setTimeout(() => {
            context.dispatchAppEvent("board", 42);
            context.dispatchAppEvent("board2");
        }, 1000);
    },
};

const BoardFooter = ({ context }: { context: AppContext }) => {
    const [pageState, setPageState] = useState({ index: 0, length: 0 });

    const nextPage = () => context.nextPage();

    const prevPage = () => context.prevPage();

    const addPage = () => context.addPage();

    const removePage = () => context.removePage(1);

    const removeLastPage = () => context.removePage(context.pageState.length - 1);

    useEffect(() => {
        setPageState(context.pageState);
        return context.emitter.on("pageStateChange", pageState => {
            console.log("pageStateChange", pageState);
            setPageState(pageState);
        });
    }, []);

    return (
        <div className="board-footer">
            <button onClick={prevPage}>上一页</button>
            <button onClick={nextPage}>下一页</button>
            <button onClick={addPage}>添加页</button>
            <button onClick={removePage}>删除一页</button>
            <button onClick={removeLastPage}>删除最后一页</button>
            {pageState.index + 1}/{pageState.length}
        </div>
    );
};

export const mount = (dom: HTMLElement, context: AppContext) => {
    ReactDom.render(<BoardFooter context={context} />, dom);
};
