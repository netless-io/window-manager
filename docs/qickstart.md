# 快速上手

## 安装
通过 `npm` 或 `yarn` 来安装 `WindowManager`.
```shell
# npm
$ npm install @netless/window-manager

# yarn
$ yarn add @netless/window-manager
```

引用
```typescript
import { WhiteWindowSDK } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";
```

## 开始使用

### 准备容器
在页面中创建一个用于挂载的容器
```html
<div id="container"></div>
```

### 初始化 SDK
```typescript
const sdk = new WhiteWindowSDK({
    appIdentifier: "appIdentifier"
})
```

### 加入房间并挂载容器
```typescript
const manager = await sdk.mount({
    joinRoomParams: {
        uuid: "room uuid",
        roomToken: "room token",
    },
    mountParams: {
        container: document.getElementById("container")
    }
})
```

### 卸载
```typescript
manager.destroy();
```
