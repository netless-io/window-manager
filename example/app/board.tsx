import type { NetlessApp, WhiteBoardView } from "../../dist";
import React, { useEffect, useState } from "react";
import ReactDom from "react-dom";
import "./board.css";

export const Board: NetlessApp = {
    kind: "Board",
    setup:  async context => {
        // 获取 app 的 box
        const box = context.box;

        console.log("destroyed", context.destroyed);
         // 挂载白板到当前 box
        const view = context.createWhiteBoardView();
        if (context.isAddApp) {
            view.setRect({ width: 1280, height: 720 });
        }
        view.view.disableCameraTransform = false;
        view.camera$.subscribe(camera => {
            console.log("onCameraChange", camera);
        });

        console.log("box Ratio", box.ratio)
        // view.ensureSize(10);
        // view.view.disableCameraTransform = true;
        const stage = document.createElement("div");
        stage.textContent = "stage";
        box.mountStage(stage);
        context.emitter.on("destroy", () => {
            console.log("on destroy", context.destroyed);
        });
        // 挂载自定义的 footer 到 box 的 footer 上
        mount(box.$footer, view);
        return;
    }
}

const BoardFooter = ({ view }: { view: WhiteBoardView }) => {
    
    const [pageState, setPageState] = useState({ index: 0, length: 0 });

    const nextPage = () => view.nextPage();
    
    const prevPage = () => view.prevPage();

    const addPage = () =>  view.addPage();

    const removePage = () => view.removePage(1);

    const removeLastPage = () => view.removePage(view.pageState.length - 1);

    const moveCamera = () => view.moveCamera({ centerY: view.camera$.value.centerY + 10 });

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
            <button onClick={moveCamera}>移动 camera</button>
            {pageState.index + 1}/{pageState.length}
        </div>
    )
}

export const mount = (dom: HTMLElement, view: WhiteBoardView) => {
    ReactDom.render(<BoardFooter view={view} />, dom)
}
