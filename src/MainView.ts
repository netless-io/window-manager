import { AnimationMode, reaction } from 'white-web-sdk';
import { Fields } from './AttributesDelegate';
import { isEmpty, isEqual } from 'lodash';
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";

export class MainViewProxy {
    private scale?: number;
    private size?: Size;
    private disposers: any[] = [];
    
    constructor(private manager: AppManager) {
        const delegate = this.manager.delegate;
        const displayer = this.manager.displayer;

        this.disposers.push(
            reaction(
                () => this.manager.attributes[Fields.MainViewCamera],
                camera => {
                    if (delegate.broadcaster !== displayer.observerId && camera) {
                        this.moveCamera(camera);
                    }
                },
                {
                    fireImmediately: true,
                }
            )
        );
        this.disposers.push(
            reaction(
                () => this.manager.attributes[Fields.MainViewSize],
                size => {
                    if (delegate.broadcaster !== displayer.observerId && size) {
                        this.moveCameraToContian(size);
                        this.moveCamera(delegate.getMainViewCamera());
                    }
                },
                {
                    fireImmediately: true,
                }
            )
        );

    }

    public get view(): View {
        return this.manager.viewManager.mainView;   
    }

    public moveCameraToContian(size: Size): void {
        if (!isEmpty(size) && !isEqual(size, this.size)) {
            this.view.moveCameraToContain({
                width: size.width,
                height: size.height,
                originX: -size.width / 2,
                originY: -size.height / 2,
                animationMode: AnimationMode.Immediately,
            });
            this.size = size;
            this.scale = this.view.camera.scale;
        }
    }

    public moveCamera(camera: Camera): void {
        if (!isEmpty(camera)) {
            if (isEqual(camera, this.view.camera)) return;
            const { centerX, centerY, scale } = camera;
            const needScale = scale * (this.scale || 1);
            this.view.moveCamera({
                centerX: centerX,
                centerY: centerY,
                scale: needScale,
                animationMode: AnimationMode.Immediately,
            });
        }
    }

    public destroy() {
        this.disposers.forEach(disposer => disposer());
    }
}
