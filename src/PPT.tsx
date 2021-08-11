import React from 'react';
import ReactDOM from 'react-dom';
import { PluginContext } from './PluginContext';
import { Room, View } from 'white-web-sdk';

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
    },
    setup: (context: PluginContext) => {
        // console.log("setup", context);
        context.emitter.on("create", () => {
            console.log("create");
            // context.setAttributes({ aaaaa: 1 });
            // context.emit("setBoxSize", { width: 400, height: 400 });
            context.emitter.on("attributesUpdate", attributes => {
                // console.log("attributesUpdate", attributes);
            });
            console.log("isWritable", context.getIsWritable());
            context.emitter.on("sceneStateChange", state => {
                // console.log(state);
            });
            const box = context.getBox();
            console.log("context context", box?.$content);
            if (box) {
                const view = context.getView();
                const initScenePath = context.getInitScenePath();
                ReactDOM.render(
                    <PPTWrapper
                        view={view}
                        initScenePath={initScenePath!}
                    />,
                    box.$content!
                );
            }
            console.log("context footer", box?.$footer);
        });
    },
};
