import { Room, View } from "white-web-sdk"
import React from "react";

type Context = {
    room: Room;
    on: (event: string, listener: () => void) => void;
    view: View;
    setAttributes: (attributes: any) => void;
    emit: (eventName: string, data: any) => void;
}

type PPTWrapperProps = {
    view: View;
    scenes: { name: string }[];
    initScenePath: string;
}

type PPTWrapperState = {
    page: number;
}

class PPTWrapper extends React.Component<PPTWrapperProps, PPTWrapperState> {

    constructor(props: PPTWrapperProps) {
        super(props);
        this.state = {
            page: 1
        }
    }

    componentDidMount() {
        console.log(this.props);
    }

    setRef = (ref: HTMLDivElement) => {
        console.log(this.props);
        this.props.view.divElement = ref;
        this.props.view.focusScenePath = `${this.props.initScenePath}/${this.getCurrentPathName()}`;
    }

    onClick = () => {
        this.setState({ page: this.state.page + 1 });
        this.props.view.focusScenePath = `${this.props.initScenePath}/${this.getCurrentPathName()}`;
    }

    getCurrentPathName = () => {
        return this.props.scenes[this.state.page - 1].name;
    }

    render() {
        return (
            <div
                ref={this.setRef}
                onClick={this.onClick}
                style={{ width: "100%", height: "100%" }}>
            </div>
        );
    }
}

export default {
    kind: "PPTPlugin",
    options: {
        enableView: true
     },
    setup: (context: Context) => {
        context.on("create", () => {
            console.log("create");
            context.setAttributes({ aaaaa: 1 });
            context.emit("setBoxSize", { width: 400, height: 400 });
        });
    },
    wrapper: PPTWrapper,
}
