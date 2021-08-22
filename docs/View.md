
### View

白板的 `View` 是一个本地的对象, 并不会跟随整个房间走.

为了跟 `room.setScenePath` 配合使用需要对 `View` 进行特殊处理才能使得切换时不闪烁

`View` 切换流程

1. 切换所有 `View` 为 `Freedom`
2. 延时设置 `Room SceenPath`
3. 根据状态切换 `View` 为可写