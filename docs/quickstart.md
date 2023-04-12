# Get started quickly

## Install
Install `WindowManager` via `npm` or `yarn`.
```bash
# npm
$ npm install @netless/window-manager

# yarn
$ yarn add @netless/window-manager
```

Import:
```typescript
import { WhiteWindowSDK } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";
```

## Start using

### Prepare container
Create a container for mounting in the page
```html
<div id="container"></div>
```

### Initialize the SDK
```typescript
const sdk = new WhiteWindowSDK({
     appIdentifier: "appIdentifier"
})
```

### Join the room and mount the container
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

### Uninstall
```typescript
manager.destroy();
```
