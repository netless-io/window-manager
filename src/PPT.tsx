import { Room, View } from "white-web-sdk"
import React from "react";

type Context = {
    room: Room;
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

    setRef = (ref: HTMLDivElement) => {
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
        )
    }
}

export default {
    kind: "PPTPlugin",
    options: {  },
    setup: (context: Context) => {
        console.log("setup");
    },
    wrapper: PPTWrapper,
}
