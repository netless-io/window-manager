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
    <div class="netless-window-manager-main-view"></div>
</div>
```


### `WindowManager.mount()` 迁移

废弃 `chessboard` 属性

添加: `containerStyle` 配置
添加: `stageStyle` 配置
添加: `fullscreen` 配置

### `manager.setContainerSizeRatio()` 行为修改

1.0 之前反复修改 `containerSizeRatio` 会导致内容一直变小

1.0 之后重复修改 `containerSizeRatio` 不会导致内容一致缩小

