## 迁移至 `@netless/window-manager@1.0`

### 样式

1.0 之前

```html
<div class="netless-window-manager-playground">
    <div class="netless-window-manager-sizer">
        <div class="netless-window-manager-wrapper">
            <div class="netless-window-manager-main-view"></div>
        </div>
    </div>
</div>
```

1.0 之后

```html
<div class="netless-window-manager-playground">
    <div class="telebox-manager-container">
        <div class="telebox-manager-stage">
            <div class="netless-window-manager-main-view"></div>
        </div>
    </div>
</div>
```


### `WindowManager.mount()` 迁移

废弃: `chessboard` 属性

- 添加: `containerStyle` 配置
  - 配置 `telebox-manager-container` 的样式
- 添加: `stageStyle` 配置**
  - 配置 `telebox-manager-stage` 的样式
- 添加: `defaultBoxBodyStyle` 配置
  - 配置应用窗口默认 `body` 的样式
- 添加: `defaultBoxStageStyle` 配置
  - 配置应用窗口默认 `stage` 也就是内容区域的样式
- 添加: `fullscreen` 配置
  - 控制应用是否以全屏模式进入
- 添加: `theme` 配置
  - 配置默认的颜色变量

### `manager.setContainerSizeRatio()` 行为修改

1.0 之前反复修改 `containerSizeRatio` 会导致内容一直变小

1.0 之后重复修改 `containerSizeRatio` 不会导致内容一致缩小

### baseSize

`baseSize` 主白板会去匹配内容到此大小

添加: `manager.baseSize` 属性\
添加: `manager.setBaseSize()` 方法\
添加: `baseSizeChange` 回调

### baseCamera

主白板的 `camera` 会根据 `baseSize` 的值和 `baseCamera` 的值计算一个最终值

添加: `manager.baseSize` 属性\
添加: `baseCamera` 回调

修改 `baseCamera` 依旧通过 `manager.moveCamera` 来实现
