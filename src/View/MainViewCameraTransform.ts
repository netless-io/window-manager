import type { Camera, Rectangle, Size } from "white-web-sdk";

export type OriginSize = Readonly<Size>;

export function isValidCamera(camera: Camera | undefined): camera is Camera {
    return Boolean(
        camera &&
            Number.isFinite(camera.centerX) &&
            Number.isFinite(camera.centerY) &&
            Number.isFinite(camera.scale) &&
            camera.scale > 0
    );
}

export function isValidSize(size: Size | undefined): size is Size {
    return Boolean(
        size &&
            Number.isFinite(size.width) &&
            Number.isFinite(size.height) &&
            size.width > 0 &&
            size.height > 0
    );
}

export function normalizeOriginSize(size: Size | undefined): OriginSize | undefined {
    if (size === undefined) return undefined;
    if (!isValidSize(size)) {
        throw new Error(
            `[WindowManager]: originSize width and height must be finite positive numbers, but got ${JSON.stringify(
                size
            )}`
        );
    }
    return Object.freeze({ width: size.width, height: size.height });
}

export function isSameOriginSize(a: Size | undefined, b: Size | undefined): boolean {
    return Boolean(a && b && a.width === b.width && a.height === b.height);
}

export function getMainViewBaseScale(referenceSize: Size, localSize: Size): number | undefined {
    if (!isValidSize(referenceSize) || !isValidSize(localSize)) return undefined;
    const scale = Math.min(
        localSize.width / referenceSize.width,
        localSize.height / referenceSize.height
    );
    return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

export function mainViewCameraToLocal(
    camera: Camera,
    referenceSize: Size,
    localSize: Size
): Camera | undefined {
    if (!isValidCamera(camera)) return undefined;
    const baseScale = getMainViewBaseScale(referenceSize, localSize);
    if (baseScale === undefined) return undefined;
    const localCamera = {
        centerX: camera.centerX,
        centerY: camera.centerY,
        scale: camera.scale * baseScale,
    };
    return isValidCamera(localCamera) ? localCamera : undefined;
}

export function localCameraToMainView(
    camera: Camera,
    referenceSize: Size,
    localSize: Size
): Camera | undefined {
    if (!isValidCamera(camera)) return undefined;
    const baseScale = getMainViewBaseScale(referenceSize, localSize);
    if (baseScale === undefined) return undefined;
    const mainViewCamera = {
        centerX: camera.centerX,
        centerY: camera.centerY,
        scale: camera.scale / baseScale,
    };
    return isValidCamera(mainViewCamera) ? mainViewCamera : undefined;
}

export function mainViewCameraToContain(
    rectangle: Rectangle,
    referenceSize: Size
): Camera | undefined {
    if (!isValidSize(referenceSize)) return undefined;

    let scale: number;
    if (rectangle.width === 0 || rectangle.height === 0) {
        scale = 1;
    } else {
        let scaleX = referenceSize.width / rectangle.width;
        let scaleY = referenceSize.height / rectangle.height;
        if (Number.isNaN(scaleX) || scaleX <= 0) scaleX = 1;
        if (Number.isNaN(scaleY) || scaleY <= 0) scaleY = 1;
        scale = Math.min(scaleX, scaleY);
    }

    const camera = {
        centerX: rectangle.originX + rectangle.width / 2,
        centerY: rectangle.originY + rectangle.height / 2,
        scale,
    };
    return isValidCamera(camera) ? camera : undefined;
}

export function getEffectiveOriginSize(originSize: Size, containerSizeRatio: number): Size {
    if (!isValidSize(originSize)) {
        throw new Error(
            "[WindowManager]: cannot calculate effectiveOriginSize from invalid originSize"
        );
    }
    if (!Number.isFinite(containerSizeRatio) || containerSizeRatio <= 0) {
        throw new Error(
            `[WindowManager]: containerSizeRatio must be a finite positive number, but got ${containerSizeRatio}`
        );
    }
    const effectiveOriginSize =
        originSize.height / originSize.width > containerSizeRatio
            ? {
                  width: originSize.height / containerSizeRatio,
                  height: originSize.height,
              }
            : {
                  width: originSize.width,
                  height: originSize.width * containerSizeRatio,
              };
    if (!isValidSize(effectiveOriginSize)) {
        throw new Error("[WindowManager]: effectiveOriginSize exceeds the finite size range");
    }
    return effectiveOriginSize;
}
