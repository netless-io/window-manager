import { Room, View } from "white-web-sdk";
import React from "react";
import ReactDOM from "react-dom";
import { } from "./typings";
import { PluginContext } from "./PluginContext";

type PPTWrapperProps = {
    view: View;
    // scenes: { name: string }[];
    initScenePath: string;
};

type PPTWrapperState = {
    page: number;
};

class PPTWrapper extends React.Component<PPTWrapperProps, PPTWrapperState> {
    private wrapperRef: HTMLDivElement | null = null;
    private viewRef: HTMLDivElement | null = null;

    constructor(props: PPTWrapperProps) {
        super(props);
        this.state = {
            page: 1,
        };
    }

    componentDidMount() {
        console.log(this.props);
    }

    setRef = (ref: HTMLDivElement) => {
        this.viewRef = ref;
        console.log(this.props.view);
        this.props.view.divElement = ref;
        // this.props.view.focusScenePath = `${this.props.initScenePath}/${this.props.scenes[0].name}`;
    };

    // nextPage = () => {
    //     this.setState({ page: this.state.page + 1 });
    //     this.props.view.focusScenePath = `${this.props.initScenePath}/${this.getCurrentPathName()}`;
    // }

    // getCurrentPathName = () => {
    //     return this.props.scenes[this.state.page - 1]?.name;
    // }

    onWheel = () => {
        if (this.viewRef) {
            this.viewRef.style.pointerEvents = "none";
        }
    };

    onClick = () => {
        if (this.viewRef) {
            this.viewRef.style.pointerEvents = "auto";
        }
    };

    setWrapperRef = (ref: HTMLDivElement) => {
        this.wrapperRef = ref;
    };

    render() {
        return (
            <div
                ref={this.setWrapperRef}
                onWheel={this.onWheel}
                onClick={this.onClick}
                style={{ width: "100%", height: "100%" }}
            >
                <div ref={this.setRef} style={{ width: "100%", height: "100%" }}></div>
            </div>
        );
    }
}

export default {
    kind: "PPTPlugin",
    config: {
        enableView: true,
        width: 500,
        height: 600,
    },
    setup: (context: PluginContext) => {
        console.log("setup", context);
        context.emitter.on("create", () => {
            console.log("create");
            context.setAttributes({ aaaaa: 1 });
            // context.emit("setBoxSize", { width: 400, height: 400 });
            context.emitter.on("attributesUpdate", (attributes: any) => {
                console.log("attributesUpdate", attributes);
            });
            console.log("isWritable", context.isWritable);
            context.emitter.on("sceneStateChange", (state: any) => {
                console.log(state);
            });
            console.log("context context", context.content);
            if (context.content) {
                ReactDOM.render(
                    <PPTWrapper
                        view={context.view}
                        initScenePath={context.initScenePath!}
                    />,
                    context.content
                );
            }
            console.log("context footer", context.footer);
        });
    },
};
