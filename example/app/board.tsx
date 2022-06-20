import type { NetlessApp, TeleBoxRect, WhiteBoardView } from "../../dist";
import React, { useEffect, useState } from "react";
import ReactDom from "react-dom";
import "./board.css";

export const Board: NetlessApp = {
    kind: "Board",
    setup:  async context => {
        // 获取 app 的 box
        const box = context.box;

        const stage = document.createElement("div");
        stage.addEventListener("click", () => {
            console.log("onStage click");
        });
        addStyle(stage, box.contentStageRect);

        box._contentStageRect$.subscribe(rect => {
            addStyle(stage, rect);
        });
        console.log("destroyed", context.destroyed);
         // 挂载白板到当前 box
        const view = context.createWhiteBoardView();
        view.ensureSize(10);
        view.view.disableCameraTransform = true;
        box.$content.appendChild(stage);
        context.emitter.on("destroy", () => {
            console.log("on destroy", context.destroyed);
        });
        // 挂载自定义的 footer 到 box 的 footer 上
        mount(box.$footer, view);
        return;
    }
}

const addStyle = (el: HTMLDivElement, rect: TeleBoxRect) => {
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.position = "absolute";
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.backgroundColor = "gray";
    el.style.zIndex = "-1";
}

const BoardFooter = ({ view }: { view: WhiteBoardView }) => {
    
    const [pageState, setPageState] = useState({ index: 0, length: 0 });

    const nextPage = () => view.nextPage();
    
    const prevPage = () => view.prevPage();

    const addPage = () =>  view.addPage();

    const removePage = () => view.removePage(1);

    const removeLastPage = () => view.removePage(view.pageState.length - 1);

    useEffect(() => {
        setPageState(view.pageState);
        // 订阅 pageState 的修改
        return view.pageState$.subscribe(pageState => {
            console.log("subscribe pageState", pageState);
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
    )
}

export const mount = (dom: HTMLElement, view: WhiteBoardView) => {
    ReactDom.render(<BoardFooter view={view} />, dom)
}
