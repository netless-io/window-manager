# Concept

## Sync Zone

On devices with different resolutions, if we want to see the same area and window, we need to maintain the same ratio on all devices.

So `WindowManager` has a `containerSizeRatio` option to configure the aspect ratio of the whiteboard, the default is `9 / 16`

If the width and height given to WindowManager by the outer layer do not perfectly fit this aspect ratio, WindowManger will automatically calculate a maximum width and height that fits this ratio internally, and then fill it in. At this time, there will be some internal areas that cannot be operated

