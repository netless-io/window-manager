import type { Displayer, DisplayerState, Room, RoomState } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { WindowManager } from "../index";

import Emittery from "emittery";
import { PlayerPhase, AnimationMode, autorun } from "white-web-sdk";
import { SideEffectManager } from "side-effect-manager";
import { debounce, noop } from "lodash";
import { log } from "../Utils/log";

// Note: typo below should not be fixed.
export enum IframeEvents {
  Init = "Init",
  AttributesUpdate = "AttributesUpdate",
  SetAttributes = "SetAttributes",
  RegisterMagixEvent = "RegisterMagixEvent",
  RemoveMagixEvent = "RemoveMagixEvent",
  RemoveAllMagixEvent = "RemoveAllMagixEvent",
  RoomStateChanged = "RoomStateChanged",
  DispatchMagixEvent = "DispatchMagixEvent",
  ReciveMagixEvent = "ReciveMagixEvent",
  NextPage = "NextPage",
  PrevPage = "PrevPage",
  SDKCreate = "SDKCreate",
  OnCreate = "OnCreate",
  SetPage = "SetPage",
  GetAttributes = "GetAttributes",
  Ready = "Ready",
  Destory = "Destory",
  StartCreate = "StartCreate",
  WrapperDidUpdate = "WrapperDidUpdate",
  DispayIframe = "DispayIframe",
  HideIframe = "HideIframe",
  GetRootRect = "GetRootRect",
  ReplayRootRect = "ReplayRootRect",
  PageTo = "PageTo",
}

export enum DomEvents {
  WrapperDidMount = "WrapperDidMount",
  IframeLoad = "IframeLoad",
}

export type IframeBridgeAttributes = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly displaySceneDir: string;
  readonly lastEvent?: { name: string, payload: any };
  readonly useClicker?: boolean;
  readonly useSelector?: boolean;
};

export type IframeBridgeEvents = {
  created: undefined;
  [IframeEvents.Ready]: undefined;
  [IframeEvents.StartCreate]: undefined;
  [IframeEvents.OnCreate]: IframeBridge;
  [IframeEvents.Destory]: undefined;
  [IframeEvents.GetRootRect]: undefined;
  [IframeEvents.ReplayRootRect]: DOMRect;
  [DomEvents.WrapperDidMount]: undefined;
  [IframeEvents.WrapperDidUpdate]: undefined;
  [DomEvents.IframeLoad]: Event;
  [IframeEvents.HideIframe]: undefined;
  [IframeEvents.DispayIframe]: undefined;
}

export type IframeSize = {
  readonly width: number;
  readonly height: number;
};

type BaseOption = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly displaySceneDir: string;
}

export type InsertOptions = {
  readonly useClicker?: boolean;
  readonly useSelector?: boolean;
} & BaseOption;

export type OnCreateInsertOption = {
  readonly displayer: Displayer;
} & BaseOption;

const RefreshIDs = {
  Ready: IframeEvents.Ready,
  RootRect: IframeEvents.ReplayRootRect,
  Message: "message",
  ComputeStyle: "computeStyle",
  Load: "load",
  DisplayerState: "displayerState",
  Show: "show",
  Hide: "hide",
};

const times = <T>(number: number, iteratee: (value: number) => T) => {
  return new Array(number).fill(0).map((_, index) => iteratee(index));
};

/**
 * {@link https://github.com/netless-io/netless-iframe-bridge @netless/iframe-bridge}
 */
export class IframeBridge {
  public static readonly kind = "IframeBridge";
  public static readonly hiddenClass = "netless-iframe-brdige-hidden";
  public static emitter: Emittery<IframeBridgeEvents> = new Emittery();
  private static displayer: Displayer | null = null
  private static alreadyCreate = false;

  public displayer: Displayer;
  public iframe: HTMLIFrameElement;

  private readonly magixEventMap = new Map<string, any>();
  private cssList: string[] = [];
  private allowAppliances: string[] = ["clicker"];
  private bridgeDisposer: () => void = noop;
  private rootRect: DOMRect | null = null;

  private sideEffectManager = new SideEffectManager();

  constructor(readonly manager: WindowManager, readonly appManager: AppManager) {
    this.displayer = IframeBridge.displayer = appManager.displayer;

    this.iframe = this._createIframe();

    this.sideEffectManager.addDisposer(IframeBridge.emitter.on(IframeEvents.ReplayRootRect, rect => {
      this.rootRect = rect;
    }), RefreshIDs.RootRect);

    this.sideEffectManager.addDisposer(IframeBridge.emitter.on(IframeEvents.HideIframe, () => {
      this.iframe.className = IframeBridge.hiddenClass;
    }), RefreshIDs.Hide);

    this.sideEffectManager.addDisposer(IframeBridge.emitter.on(IframeEvents.DispayIframe, () => {
      this.iframe.className = "";
    }), RefreshIDs.Show);

    this.sideEffectManager.addDisposer(IframeBridge.emitter.on("created", () => {
      this.bridgeDisposer();
      this.bridgeDisposer = autorun(() => {
        const attributes = this.attributes;
        if (attributes.url) {
          const iframeSrc = this.iframe?.src;
          if (iframeSrc && iframeSrc !== attributes.url) {
            this.execListenIframe(attributes);
          }
        }
        if (attributes.displaySceneDir) {
          this.computedIframeDisplay(this.displayer.state, attributes);
        }
        if ((attributes.width || attributes.height) && this.iframe) {
          this.iframe.width = `${attributes.width}px`;
          this.iframe.height = `${attributes.height}px`;
        }
        this.postMessage({ kind: IframeEvents.AttributesUpdate, payload: attributes });
      });
    }));

    this.sideEffectManager.addDisposer(manager.emitter.on("cameraStateChange", () => {
      this.computedStyle(this.displayer.state);
    }));

    IframeBridge.onCreate(this);
  }

  public static onCreate(plugin: IframeBridge): void {
    IframeBridge.emitter.emit(IframeEvents.StartCreate);
    IframeBridge.emitter.emit(IframeEvents.OnCreate, plugin);
    IframeBridge.emitter.emit("created");
  }

  public insert(options: InsertOptions): this {
    const initAttributes: IframeBridgeAttributes = {
      url: options.url,
      width: options.width,
      height: options.height,
      displaySceneDir: options.displaySceneDir,
      useClicker: options.useClicker || false,
      useSelector: options.useSelector,
    };
    this.setAttributes(initAttributes);

    const wrapperDidMountListener = () => {
      this.getIframe()
      this.listenIframe(this.attributes);
      this.listenDisplayerState();
      IframeBridge.emitter.emit(IframeEvents.GetRootRect);
    };

    if (this.getIframe()) {
      wrapperDidMountListener();
    }
    // Code below will never be executed, just copying the old code...
    else {
      const didMount = this.sideEffectManager.addDisposer(IframeBridge.emitter.on(DomEvents.WrapperDidMount, () => {
        wrapperDidMountListener();
        this.sideEffectManager.flush(didMount);
      }));
      const didUpdate = this.sideEffectManager.addDisposer(IframeBridge.emitter.on(IframeEvents.WrapperDidUpdate, () => {
        wrapperDidMountListener();
        this.sideEffectManager.flush(didUpdate);
      }));
    }
    if (this.attributes.useSelector) {
      this.allowAppliances.push("selector");
    }

    this.computedStyle(this.displayer.state);
    this.listenDisplayerCallbacks();
    this.getComputedIframeStyle();
    this.sideEffectManager.addEventListener(window, "message",
      this.messageListener.bind(this), void 0, RefreshIDs.Message);

    IframeBridge.alreadyCreate = true;
    return this;
  }

  // 在某些安卓机型中会遇到 iframe 嵌套计算 bug，需要手动延迟触发一下重绘
  private getComputedIframeStyle(): void {
    this.sideEffectManager.setTimeout(() => {
      if (this.iframe) {
        getComputedStyle(this.iframe);
      }
    }, 200, RefreshIDs.ComputeStyle);
  }

  public destroy() {
    this.sideEffectManager.flushAll();
    IframeBridge.emitter.emit(IframeEvents.Destory);
    IframeBridge.alreadyCreate = false;
    IframeBridge.emitter.clearListeners();
  }

  private getIframe(): HTMLIFrameElement {
    this.iframe || (this.iframe = this._createIframe());
    return this.iframe;
  }

  public setIframeSize(params: IframeSize): void {
    if (this.iframe) {
      this.iframe.width = `${params.width}px`;
      this.iframe.height = `${params.height}px`;
      this.setAttributes({ width: params.width, height: params.height });
    }
  }

  public get attributes(): Partial<IframeBridgeAttributes> {
    return this.appManager.store.getIframeBridge();
  }

  public setAttributes(data: Partial<IframeBridgeAttributes>): void {
    this.appManager.store.setIframeBridge(data);
  }

  private _createIframe() {
    const iframe = document.createElement("iframe");
    iframe.id = "IframeBridge";
    iframe.className = IframeBridge.hiddenClass;
    if (this.appManager.mainView.divElement) {
      this.appManager.mainView.divElement.appendChild(iframe);
    }
    return iframe;
  }

  public scaleIframeToFit(animationMode: AnimationMode = AnimationMode.Immediately) {
    if (!this.inDisplaySceneDir) {
      return;
    }
    const { width = 1280, height = 720 } = this.attributes;
    const x = width ? -width / 2 : 0;
    const y = height ? -height / 2 : 0;

    this.manager.moveCameraToContain({
      originX: x,
      originY: y,
      width,
      height,
      animationMode,
    });
  }

  public get isReplay(): boolean {
    return this.manager.isReplay;
  }

  private handleSetPage(data: any): void {
    if (this.isReplay || !this.attributes.displaySceneDir) {
      return;
    }
    const page = data.payload;
    const room = this.displayer as Room;
    const scenes = room.entireScenes()[this.attributes.displaySceneDir];
    if (!scenes || scenes.length !== page) {
      const genScenes = times<{ name: string }>(page, (index: number) => ({ name: String(index + 1) }));
      room.putScenes(this.attributes.displaySceneDir, genScenes);
      this.manager.setMainViewScenePath(this.attributes.displaySceneDir);
    }
  }

  private execListenIframe = debounce((options: Partial<IframeBridgeAttributes>) => {
    this.listenIframe(options);
  }, 50);

  private src_url_equal_anchor?: HTMLAnchorElement
  private listenIframe(options: Partial<IframeBridgeAttributes>): void {
    const loadListener = (ev: Event) => {
      this.postMessage({
        kind: IframeEvents.Init, payload: {
          attributes: this.attributes,
          roomState: IframeBridge.displayer?.state,
          currentPage: this.currentPage,
          observerId: this.displayer.observerId
        }
      })
      IframeBridge.emitter.emit(DomEvents.IframeLoad, ev);
      this.sideEffectManager.addDisposer(IframeBridge.emitter.on(IframeEvents.Ready, () => {
        this.postMessage(this.attributes.lastEvent?.payload);
      }), RefreshIDs.Ready)
      this.computedStyleAndIframeDisplay();
      // if ((this.displayer as Room).isWritable) {
      //   this.manager.moveCamera({
      //     scale: this.manager.camera.scale + 1e-6,
      //     animationMode: AnimationMode.Immediately,
      //   })
      // }
    };
    if (options.url && this.iframe.src !== options.url) {
      if (!this.src_url_equal_anchor) this.src_url_equal_anchor = document.createElement('a');
      this.src_url_equal_anchor.href = options.url
      if (this.src_url_equal_anchor.href !== this.iframe.src) {
        this.iframe.src = options.url;
      }
    }
    this.iframe.width = `${options.width}px`;
    this.iframe.height = `${options.height}px`;
    this.sideEffectManager.addEventListener(this.iframe, "load", loadListener, void 0, RefreshIDs.Load);
  }

  private onPhaseChangedListener = (phase: PlayerPhase) => {
    if (phase === PlayerPhase.Playing) {
      this.computedStyleAndIframeDisplay();
    }
  }

  private listenDisplayerState(): void {
    if (this.isReplay) {
      if ((this.displayer as any)._phase === PlayerPhase.Playing) {
        this.computedStyleAndIframeDisplay();
      }
      this.sideEffectManager.add(() => {
        this.displayer.callbacks.on("onPhaseChanged", this.onPhaseChangedListener);
        return () => this.displayer.callbacks.off("onPhaseChanged", this.onPhaseChangedListener);
      }, RefreshIDs.DisplayerState);
    }
    this.computedStyleAndIframeDisplay();
  }

  private computedStyleAndIframeDisplay(): void {
    this.computedStyle(this.displayer.state);
    this.computedIframeDisplay(this.displayer.state, this.attributes);
  }

  private listenDisplayerCallbacks(): void {
    this.displayer.callbacks.on(this.callbackName as any, this.stateChangeListener);
  }

  private get callbackName(): string {
    return this.isReplay ? "onPlayerStateChanged" : "onRoomStateChanged";
  }

  private stateChangeListener = (state: RoomState) => {
    state = { ...state };
    state.cameraState = this.manager.cameraState;
    this.postMessage({ kind: IframeEvents.RoomStateChanged, payload: state });
    if (state.cameraState) {
      IframeBridge.emitter.emit(IframeEvents.GetRootRect);
      this.computedStyle(state);
    }
    if (state.memberState) {
      this.computedZindex();
      this.updateStyle();
    }
    if (state.sceneState) {
      this.computedIframeDisplay(state, this.attributes);
    }
  }

  private computedStyle(_state: DisplayerState): void {
    const cameraState = this.manager.cameraState;
    const setWidth = this.attributes.width || 1280;
    const setHeight = this.attributes.height || 720;
    if (this.iframe) {
      const { width, height, scale, centerX, centerY } = cameraState;
      const rootRect = this.rootRect || { x: 0, y: 0 }
      const transformOriginX = `${(width / 2) + rootRect.x}px`;
      const transformOriginY = `${(height / 2) + rootRect.y}px`;
      const transformOrigin = `transform-origin: ${transformOriginX} ${transformOriginY};`;
      const iframeXDiff = ((width - setWidth) / 2) * scale;
      const iframeYDiff = ((height - setHeight) / 2) * scale;
      const x = - (centerX * scale) + iframeXDiff;
      const y = - (centerY * scale) + iframeYDiff;
      const transform = `transform: translate(${x}px,${y}px) scale(${scale}, ${scale});`;
      const position = "position: absolute;";
      // 在某些安卓机型, border-width 不为 0 时，才能正确计算 iframe 里嵌套 iframe 的大小
      const borderWidth = "border: 0.1px solid rgba(0,0,0,0);";
      const left = `left: 0px;`;
      const top = `top: 0px;`;
      const cssList = [position, borderWidth, top, left, transformOrigin, transform];
      this.cssList = cssList;
      this.computedZindex();
      this.updateStyle();
    }
  }

  private computedIframeDisplay(_state: DisplayerState, _attributes: Partial<IframeBridgeAttributes>): void {
    if (this.inDisplaySceneDir) {
      IframeBridge.emitter.emit(IframeEvents.DispayIframe);
    } else {
      IframeBridge.emitter.emit(IframeEvents.HideIframe);
    }
  }

  public computedZindex(): void {
    const zIndexString = "z-index: -1;";
    const index = this.cssList.findIndex(css => css === zIndexString);
    if (index !== -1) {
      this.cssList.splice(index, 1);
    }
    if (!this.isClicker() || this.isDisableInput) {
      this.cssList.push(zIndexString);
    }
  }

  private updateStyle(): void {
    this.iframe.style.cssText = this.cssList.join(" ");
  }

  private get iframeOrigin(): string | undefined {
    if (this.iframe) {
      try {
        return new URL(this.iframe.src).origin;
      } catch (err) {
        console.warn(err);
      }
    }
  }

  private messageListener(event: MessageEvent): void {
    log("<<<", JSON.stringify(event.data));
    if (event.origin !== this.iframeOrigin) {
      return;
    }
    const data = event.data;
    switch (data.kind) {
      case IframeEvents.SetAttributes: {
        this.handleSetAttributes(data);
        break;
      }
      case IframeEvents.RegisterMagixEvent: {
        this.handleRegisterMagixEvent(data);
        break;
      }
      case IframeEvents.RemoveMagixEvent: {
        this.handleRemoveMagixEvent(data);
        break;
      }
      case IframeEvents.DispatchMagixEvent: {
        this.handleDispatchMagixEvent(data);
        break;
      }
      case IframeEvents.RemoveAllMagixEvent: {
        this.handleRemoveAllMagixEvent();
        break;
      }
      case IframeEvents.NextPage: {
        this.handleNextPage();
        break;
      }
      case IframeEvents.PrevPage: {
        this.handlePrevPage();
        break;
      }
      case IframeEvents.SDKCreate: {
        this.handleSDKCreate();
        break;
      }
      case IframeEvents.SetPage: {
        this.handleSetPage(data);
        break;
      }
      case IframeEvents.GetAttributes: {
        this.handleGetAttributes();
        break;
      }
      case IframeEvents.PageTo: {
        this.handlePageTo(data);
        break
      }
      default: {
        log(`${data.kind} not allow event.`);
        break;
      }
    }
  }

  private handleSDKCreate(): void {
    this.postMessage({
      kind: IframeEvents.Init, payload: {
        attributes: this.attributes,
        roomState: this.displayer.state,
        currentPage: this.currentPage,
        observerId: this.displayer.observerId
      }
    });
  }

  private handleDispatchMagixEvent(data: any): void {
    const eventPayload: { event: string, payload: any } = data.payload;
    this.appManager.safeDispatchMagixEvent(eventPayload.event, eventPayload.payload);
  }

  private handleSetAttributes(data: any): void {
    this.setAttributes(data.payload);
  }

  private handleRegisterMagixEvent(data: any): void {
    const eventName = data.payload as string;
    const listener = (event: any) => {
      if (event.authorId === this.displayer.observerId) {
        return;
      }
      this.postMessage({ kind: IframeEvents.ReciveMagixEvent, payload: event });
    };
    this.magixEventMap.set(eventName, listener);
    this.displayer.addMagixEventListener(eventName, listener);
  }

  private handleRemoveMagixEvent(data: any): void {
    const eventName = data.payload as string;
    const listener = this.magixEventMap.get(eventName);
    this.displayer.removeMagixEventListener(eventName, listener);
  }

  private handleNextPage(): void {
    if (this.manager.canOperate) {
      this.manager.nextPage();
      this.dispatchMagixEvent(IframeEvents.NextPage, {});
    }
  }

  private handlePrevPage(): void {
    if (this.manager.canOperate) {
      this.manager.prevPage();
      this.dispatchMagixEvent(IframeEvents.PrevPage, {});
    }
  }

  private handlePageTo(data: any): void {
    if (this.manager.canOperate) {
      const page = data.payload as number;
      if (!Number.isSafeInteger(page) || page <= 0) {
        return;
      }
      this.manager.setMainViewSceneIndex(page - 1);
      this.dispatchMagixEvent(IframeEvents.PageTo, page - 1);
    }
  }

  private handleRemoveAllMagixEvent(): void {
    this.magixEventMap.forEach((listener, event) => {
      this.displayer.removeMagixEventListener(event, listener);
    });
    this.magixEventMap.clear();
  }

  private handleGetAttributes(): void {
    this.postMessage({
      kind: IframeEvents.GetAttributes,
      payload: this.attributes,
    });
  }

  public postMessage(message: any): void {
    if (this.iframe) {
      this.iframe.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), "*");
    }
  }

  public dispatchMagixEvent(event: string, payload: any): void {
    if (this.manager.canOperate) {
      this.setAttributes({ lastEvent: { name: event, payload } });
      (this.displayer as Room).dispatchMagixEvent(event, payload);
    }
  }

  private get currentIndex(): number {
    return this.manager.mainViewSceneIndex;
  }

  private get currentPage(): number {
    return this.currentIndex + 1;
  }

  private get totalPage(): number {
    return this.manager.mainViewScenesLength;
  }

  private get readonly(): boolean {
    return !(this.displayer as any).isWritable;
  }

  public get inDisplaySceneDir(): boolean {
    return this.manager.mainViewSceneDir === this.attributes.displaySceneDir;
  }

  private isClicker(): boolean {
    if (this.readonly) {
      return false;
    }
    const currentApplianceName = (this.displayer as Room).state.memberState.currentApplianceName;
    return this.allowAppliances.includes(currentApplianceName);
  }

  private get isDisableInput(): boolean {
    if ("disableDeviceInputs" in this.displayer) {
      return (this.displayer as Room).disableDeviceInputs;
    } else {
      return true;
    }
  }
}
