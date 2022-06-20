import type { Camera, Size } from "white-web-sdk";


export interface ViewSync {
    readonly camera: Camera;
    readonly size: Size;

    setCamera: (camera: Camera) => void;
    setSize: (size: Size) => void;      
}
