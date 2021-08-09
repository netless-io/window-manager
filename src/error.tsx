import React from "react";
import { emitter } from "./index";

export class ErrorBoundary extends React.Component<{
    pluginId: string
}, { hasError: boolean }> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false };
    }

    componentDidCatch(error: Error, errorInfo: any) {
        this.setState({ hasError: true });
        emitter.emit("close", {
            pluginId: this.props.pluginId,
            error: JSON.stringify(error),
            errorInfo: errorInfo,
        });
    }

    render() {
        if (this.state.hasError) {
            return <h1>Plugin Error</h1>;
        }

        return this.props.children;
    }
}
