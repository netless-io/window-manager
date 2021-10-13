import { ApplianceNames } from "white-web-sdk";
import pencil from "../image/pencil-cursor.png";
import selector from "../image/selector-cursor.png";
import eraser from "../image/eraser-cursor.png";
import shape from "../image/shape-cursor.svg";
import text from "../image/text-cursor.svg";

export const ApplianceMap: {
    [key: string]: string;
} = {
    [ApplianceNames.pencil]: pencil,
    [ApplianceNames.selector]: selector,
    [ApplianceNames.eraser]: eraser,
    [ApplianceNames.shape]: shape,
    [ApplianceNames.text]: text,
};
