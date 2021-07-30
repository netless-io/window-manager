import * as React from "react";
import * as ReactDOM from "react-dom";
import { WinBox } from "./box/src/winbox";

import { emitter, EventNames, PluginAttributes, WindowManager } from "./index";
import debounce from "lodash.debounce";
import { View, ViewMode, ViewVisionMode } from "white-web-sdk";
 
export class WindowManagerWrapper extends React.Component {
    public static componentsMap = new Map<string, any>();
    public static winboxMap = new Map<string, WinBox>();
    public winboxMap = WindowManagerWrapper.winboxMap;

    constructor(props: any) {
        super(props);
        emitter.on(EventNames.PluginMove, this.pluginMoveListener);
        emitter.on(EventNames.PluginFocus, this.pluginFocusListener);
        emitter.on(EventNames.PluginResize, this.pluginResizeListener);
        emitter.on(EventNames.UpdateWindowManagerWrapper, this.messageListener);
    }

    componentDidMount() {
        // window.addEventListener("resize", this.windowResizeListener);
    }

    componentWillUnmount(): void {
        emitter.clearListeners();
        this.winboxMap.forEach(box => {
            box.unmount();
        });
        this.winboxMap.clear();
        // window.removeEventListener("resize", this.windowResizeListener);
    }

    private windowResizeListener = () => {
        this.winboxMap.forEach((box, name) => {
            this.updateBoxViewPort(box);
            const pluginAttributes = WindowManager.instance.attributes[name];
            const position = pluginAttributes?.[PluginAttributes.Position];
            if (position) {
                this.pluginMoveListener({ name, ...position });
            }
        });
    }

    private pluginMoveListener = (payload: any) => {
        const pluginBox = this.winboxMap.get(payload.name);
        if (pluginBox) {
            const { width, height } = pluginBox as any;
            pluginBox.onmove = () => {};
            pluginBox.focus();
            const position = this.computedPosition(width, height, payload.x, payload.y, true);
            const x = position.x;
            const y = position.y;
            pluginBox.move(x, y);
            pluginBox.onmove = this.boxOnMove(payload.name);
        }
    }

    private pluginFocusListener = (payload: any) => {
        const pluginBox = this.winboxMap.get(payload.name);
        if (pluginBox) {
            pluginBox.focus();
        }
    }

    private pluginResizeListener = (payload: any) => {
        const pluginBox = this.winboxMap.get(payload.name);
        const cameraState = WindowManager.instance.displayer.state.cameraState;
        if (pluginBox) {
            pluginBox.onresize = () => {};
            pluginBox.focus();
            const newWidth = payload.width * cameraState.width + 20;
            const newHeigth = payload.height * cameraState.height;
            // @ts-ignore
            // pluginBox.minwidth = newWidth;
            pluginBox.resize(newWidth, newHeigth);
            pluginBox.onresize = this.boxOnResize(payload.name);
        }
    }

    private boxOnMove = (name: string): any => {
        const computedPosition = this.computedPosition;
        return function(x: number, y: number) {
            // @ts-ignore
            const { width, height } = this;
            const position = computedPosition(width, height, x, y);
            emitter.emit("move", { name, ...position });
        };
    }

    private computedPosition = (boxWidth: number, boxHeight: number, x: number, y: number, useMove: boolean = false) => {
        const cameraState = WindowManager.instance.displayer.state.cameraState;
        if (cameraState) {
            if (useMove) {
                const newX = x * (cameraState.width - boxWidth);
                const newY = y * (cameraState.height - boxHeight);
                return { x: newX, y:newY };
            } else {
                const newX = x / (cameraState.width - boxWidth);
                const newY = y / (cameraState.height - boxHeight);
                return { x: newX, y: newY };
            }
        } else {
            return { x: 0, y: 0 };
        }
    }

    private boxOnFocus = (name: string) => {
        return () => {
            emitter.emit("focus", { name });
            // const view = WindowManager.instance.viewMap.get(name);
            // if (view) {
            //     console.log(view);
            //     view.mode = ViewVisionMode.Writable;
            // }
        };
    }

    private boxOnResize = (name: string) => {
        return debounce((width: number, height: number) => {
            const cameraState = WindowManager.instance.displayer.state.cameraState;
            const widthPercentage = width / cameraState.width;
            const heightPercentage = height / cameraState.height;
            emitter.emit("resize", { name, width: widthPercentage, height: heightPercentage });
        }, 10);
    }

    private boxOnClose = (name: string) => {
        return () => {
            emitter.emit("close", { name });
            WindowManagerWrapper.componentsMap.delete(name);
            const boxDom = this.winboxMap.get(name)?.dom;
            setTimeout(() => {
                boxDom?.parentNode?.removeChild(boxDom);
            });
            this.winboxMap.delete(name);
            const wrapperDom = document.querySelector(`.${name}-wrapper`) as HTMLDivElement;
            if (wrapperDom) {
                wrapperDom.style.display = "none";
            }
            return true;
        };
    }

    componentDidCatch(error: any) {
        console.log(error);
        return (
            <div>error</div>
        );
    }

    private messageListener = () => {
        this.forceUpdate();
    }

    public static addComponent(
        name: string, 
        node: React.ReactNode,
        view: View, 
        scenes?: { name: string }[], 
        initScenePath?: string
    ): void {
        this.componentsMap.set(name, { node, view, scenes, initScenePath });
        emitter.emit(EventNames.UpdateWindowManagerWrapper, true);
    }

    private setRef = (name: string, ref: HTMLDivElement | null, Comp: any,  view: View, scenes?: any[], initScenePath?: string) => {
        if (!this.winboxMap.has(name) && ref) {
            emitter.emit("init", { name });
            let width = 640;
            let height = 480;
            if (scenes) {
                const ppt = scenes[0].ppt;
                width = ppt.width;
                height = ppt.height;
            }
            
            const box = new WinBox(name, {
                class: "modern plugin-winbox",
                width, height
            }) as WinBox;
            this.winboxMap.set(name, box);
            emitter.once(EventNames.InitReplay).then((payload) => {
                const box = this.winboxMap.get(name);
                if (box) {
                    box.mount(ref);
                    ReactDOM.render(<Comp view={view} {...{ scenes, initScenePath }} />, box.body);
                    // if (payload.x && payload.y) {
                    //     this.pluginMoveListener(payload)
                    // }
                    // if (payload.focus) {
                    //     box.focus();
                    // }
                    // if (payload.width && payload.height) {
                    //     this.pluginResizeListener(payload)
                    // }
                    // box.onmove = this.boxOnMove(name);
                    // box.onfocus = this.boxOnFocus(name);
                    // box.onresize = this.boxOnResize(name);
                    // box.onclose = this.boxOnClose(name);
                    // this.updateBoxViewPort(box);
                    // emitter.emit(`${name}${EventNames.WindowCreated}`);
                    // const view = WindowManager.instance.createView(name);
                    // if (view) {
                    //     view.divElement = box.body as HTMLDivElement;
                    // }
                }
            });
        }
    }

    private updateBoxViewPort = (box: any) => {
        const viewPort = this.getBoxViewport();
        if (viewPort) {
            const { top, left, right, bottom } = viewPort;
            box.top = top;
            box.bottom = bottom;
            box.left = left;
            box.right = right;
        }
    }

    private getBoxViewport = () => {
        const boardElement = WindowManager.boardElement;
        if (boardElement) {
            const boardRect = boardElement.getBoundingClientRect();
            const { top, left, width, height } = boardRect;
            const right = document.body.clientWidth - left - width;
            const bottom = document.body.clientHeight - top - height;
            return { top, bottom, left, right };
        }
    }

    private renderComponent(name: string, Comp: any, view: View, scenes: { name: string }[], initScenePath: string): React.ReactNode {
        return (
            <div ref={(ref) => {
                this.setRef(name, ref, Comp, view, scenes, initScenePath);
            }}
                key={`plugin-${name}`} 
                className={`${name}-wrapper`}
                style={{ width: "100%", height: "100%" }}>
            </div>
        );
    }

    private renderMaps(): React.ReactNode {
        const componentsMap = WindowManagerWrapper.componentsMap;
        const names = Array.from(componentsMap.keys());
        return (
            <>
                {names.map(name => {
                    const { node, view, scenes, initScenePath } = componentsMap.get(name);
                    return this.renderComponent(name, node, view, scenes, initScenePath);
                })}
            </>
        );
    }

    render(): React.ReactNode {
        return (
            <>
                {this.props.children}
                <div className="window-manger" style={{
                    width: "100%", height: "100%", position: "absolute", left: 0, top: 0,
                    display: "none"
                }}>
                    {this.renderMaps()}
                </div>
            </>
        );
    }
}