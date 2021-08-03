import * as React from 'react';
import * as ReactDOM from 'react-dom';
import debounce from 'lodash.debounce';
import Emittery from 'emittery';
import { Context, emitter, WindowManager } from './index';
import { Events, PluginAttributes } from './constants';
import {
    View,
    ViewMode,
    ViewVisionMode,
    WhiteScene
    } from 'white-web-sdk';
import { WinBox } from './box/src/winbox';
import { ErrorBoundary } from './error';


export type AddComponentParams = {
    pluginId: string,
    node: any,
    view?: View,
    scenes?: WhiteScene[],
    initScenePath?: string,
    emitter?: Emittery,
    options?: any,
    context: Context,
};

export const BoxMap =  new Map<string, WinBox>();

export class WindowManagerWrapper extends React.Component {
    public static componentsMap = new Map<string, any>();

    constructor(props: any) {
        super(props);
        emitter.on(Events.PluginMove, this.pluginMoveListener);
        emitter.on(Events.PluginFocus, this.pluginFocusListener);
        emitter.on(Events.PluginResize, this.pluginResizeListener);
        emitter.on(Events.UpdateWindowManagerWrapper, this.messageListener);
    }

    componentDidMount() {
        // window.addEventListener("resize", this.windowResizeListener);
    }

    componentWillUnmount(): void {
        console.log("componentWillUnmount");
        emitter.clearListeners();
        BoxMap.forEach(box => {
            box.unmount();
            box.close();
        });
        BoxMap.clear();
        // window.removeEventListener("resize", this.windowResizeListener);
    }

    componentDidCatch(error: any) {
        console.log("componentDidCatch by Wrapper", error);
        return (
            <div>error</div>
        );
    }

    private windowResizeListener = () => {
        BoxMap.forEach((box, pluginId) => {
            const view = WindowManager.viewsMap.get(pluginId);
            if (view) {
                this.updateBoxViewPort(box, view);
            }
            const pluginAttributes = WindowManager.instance.attributes[pluginId];
            const position = pluginAttributes?.[PluginAttributes.Position];
            if (position) {
                this.pluginMoveListener({ pluginId, ...position });
            }
        });
    }

    private pluginMoveListener = (payload: any) => {
        const pluginBox = BoxMap.get(payload.pluginId);
        if (pluginBox) {
            const { width, height } = pluginBox as any;
            pluginBox.onmove = () => {};
            pluginBox.focus();
            const position = this.computedPosition(width, height, payload.x, payload.y, true);
            const x = position.x;
            const y = position.y;
            pluginBox.move(x, y);
            pluginBox.onmove = this.boxOnMove(payload.pluginId);
        }
    }

    private pluginFocusListener = (payload: any) => {
        const pluginBox = BoxMap.get(payload.pluginId);
        if (pluginBox) {
            pluginBox.focus();
        }
    }

    private pluginResizeListener = (payload: any) => {
        const pluginBox = BoxMap.get(payload.pluginId);
        const cameraState = WindowManager.instance.displayer.state.cameraState;
        if (pluginBox) {
            pluginBox.onresize = () => {};
            pluginBox.focus();
            const newWidth = payload.width * cameraState.width + 20;
            const newHeigth = payload.height * cameraState.height;
            // @ts-ignore
            // pluginBox.minwidth = newWidth;
            pluginBox.resize(newWidth, newHeigth);
            pluginBox.onresize = this.boxOnResize(payload.pluginId);
        }
    }

    private boxOnMove = (pluginId: string): any => {
        const computedPosition = this.computedPosition;
        return function(x: number, y: number) {
            // @ts-ignore
            const { width, height } = this;
            const position = computedPosition(width, height, x, y);
            emitter.emit("move", { pluginId, ...position });
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

    private boxOnFocus = (pluginId: string) => {
        return () => {
            emitter.emit("focus", { pluginId });
            // const view = WindowManager.instance.viewMap.get(name);
            // if (view) {
            //     console.log(view);
            //     view.mode = ViewVisionMode.Writable;
            // }
        };
    }

    private boxOnResize = (pluginId: string) => {
        return debounce((width: number, height: number) => {
            const cameraState = WindowManager.instance.displayer.state.cameraState;
            const widthPercentage = width / cameraState.width;
            const heightPercentage = height / cameraState.height;
            emitter.emit("resize", { pluginId, width: widthPercentage, height: heightPercentage });
        }, 10);
    }

    private boxOnClose = (pluginId: string) => {
        return () => {
            emitter.emit("close", { pluginId });
            WindowManagerWrapper.componentsMap.delete(pluginId);
            const box = BoxMap.get(pluginId);
            if (box) {
                const boxDom = box.dom;
                setTimeout(() => {
                    boxDom.parentNode?.removeChild(boxDom);
                });
                // this.winboxMap.delete(pluginId);
                box.body.style.display = "none";
            }
            return true;
        };
    }

    private messageListener = () => {
        this.forceUpdate();
    }

    public static addComponent(params: AddComponentParams): void {
        this.componentsMap.set(params.pluginId, params);
        emitter.emit(Events.UpdateWindowManagerWrapper, true);
    }

    private setRef = (ref: HTMLDivElement | null, options: AddComponentParams) => {
        if (!BoxMap.has(options.pluginId) && ref) {
            emitter.emit("init", { pluginId: options.pluginId });
        
            const box = new WinBox(options.pluginId, {
                class: "modern plugin-winbox"
            });

            BoxMap.set(options.pluginId, box);
            console.log("set box Map", BoxMap)
            emitter.once(Events.InitReplay).then((payload) => {
                const box = BoxMap.get(options.pluginId);
                if (box) {
                    box.mount(ref);
                    try {
                        ReactDOM.render(
                            <ErrorBoundary pluginId={options.pluginId}>
                               <options.node {...options} displayer={WindowManager.displayer} />
                            </ErrorBoundary>
                        , box.body);
                    } catch (error) {
                        console.log("error by setRef")
                    }
                    if (payload.x && payload.y) {
                        this.pluginMoveListener(payload)
                    }
                    if (payload.focus) {
                        box.focus();
                    }
                    if (payload.width && payload.height) {
                        this.pluginResizeListener(payload)
                    }
                    box.onmove = this.boxOnMove(options.pluginId);
                    box.onfocus = this.boxOnFocus(options.pluginId);
                    box.onresize = this.boxOnResize(options.pluginId);
                    box.onclose = this.boxOnClose(options.pluginId);

                    // TODO 更新 box 的限制区域

                    emitter.emit(`${options.pluginId}${Events.WindowCreated}`);
                }
            });
        }
    }

    private updateBoxViewPort = (box: any, view: View) => {
        const viewPort = this.getBoxViewport(view);
        if (viewPort) {
            const { top, left, right, bottom } = viewPort;
            box.top = top;
            box.bottom = bottom;
            box.left = left;
            box.right = right;
        }
    }

    private getBoxViewport = (view: View) => {
        const viewElement = view.divElement;
        if (viewElement) {
            const boardRect = viewElement.getBoundingClientRect();
            const { top, left, width, height } = boardRect;
            const right = document.body.clientWidth - left - width;
            const bottom = document.body.clientHeight - top - height;
            return { top, bottom, left, right };
        }
    }

    private renderComponent(params: AddComponentParams): React.ReactNode {
        return (
            <div ref={(ref) => {
                this.setRef(ref, params);
            }}
                key={`plugin-${params.pluginId}`}
                className={`${params.pluginId}-wrapper`}
                style={{ width: "100%", height: "100%" }}>
            </div>
        );
    }

    private renderMaps() {
        const componentsMap = WindowManagerWrapper.componentsMap;
        const ids = Array.from(componentsMap.keys());
        return (
            <>
                {ids.map(id => {
                    const params = componentsMap.get(id);
                    return this.renderComponent(params);
                })}
            </>
        );
    }

    render(): React.ReactNode {
        const wrapperStyle: React.CSSProperties = {
            width: "100%", 
            height: "100%", 
            position: "absolute", 
            left: 0, 
            top: 0,
            display: "none"
        }
        return (
            <>
                {this.props.children}
                <div
                    className="window-manger" 
                    style={wrapperStyle}>
                    {this.renderMaps()}
                </div>
            </>
        );
    }
}