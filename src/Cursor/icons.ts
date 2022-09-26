import { ApplianceNames } from "white-web-sdk";
import pencil from "../image/pencil-cursor.png";
import selector from "../image/selector-cursor.png";
import eraser from "../image/eraser-cursor.png";
import shape from "../image/shape-cursor.svg";
import text from "../image/text-cursor.svg";
import laser from "../image/laser-pointer-cursor.svg";
import pencilEraser1 from "../image/pencil-eraser-1.svg";
import pencilEraser2 from "../image/pencil-eraser-2.svg";
import pencilEraser3 from "../image/pencil-eraser-3.svg";

export const ApplianceMap: {
    [key: string]: string;
} = {
    [ApplianceNames.pencil]: pencil,
    [ApplianceNames.selector]: selector,
    [ApplianceNames.eraser]: eraser,
    [ApplianceNames.shape]: shape,
    [ApplianceNames.text]: text,
    [ApplianceNames.laserPointer]: laser,
    ["pencilEraser1"]: pencilEraser1,
    ["pencilEraser2"]: pencilEraser2,
    ["pencilEraser3"]: pencilEraser3,
};
