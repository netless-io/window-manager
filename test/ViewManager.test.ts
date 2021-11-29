import { ViewManager } from "../src/ViewManager";

describe("ViewManager", () => {

    const displayer = {
        views: {
            createView: jest.fn().mockReturnValue({
                release: jest.fn(),
                focusScenePath: jest.fn(),
            })
        }
    } as any;

    afterEach(() => {
        jest.clearAllMocks();
    })

    it("should create view", () => {
        const viewManager = new ViewManager(displayer);
        const view = viewManager.createView("test");

        expect(view).toBeTruthy();
        expect(displayer.views.createView).toBeCalled();
        expect(viewManager.getView("test")).toBe(view);
        expect(viewManager.views.size).toBe(1);
    });

    it("should destroy view", () => {
        const viewManager = new ViewManager(displayer);
        const view = viewManager.createView("test");

        expect(view).toBeTruthy();
        expect(viewManager.getView("test")).toBeDefined();
        viewManager.destroyView("test");
        expect(view.release).toBeCalled();
        expect(viewManager.views.size).toBe(0);
    });

    it("should set view scenePath", () => {
        const viewManager = new ViewManager(displayer);
        const view = viewManager.createView("test");

        expect(view).toBeTruthy();
        viewManager.setViewScenePath("test", "/test");
        expect(view.focusScenePath).toBe("/test");
    });
    
    it("should destroy", () => {
        const viewManager = new ViewManager(displayer);
        const view = viewManager.createView("view1");
        viewManager.createView("view2");

        expect(viewManager.views.size).toBe(2);
        viewManager.destroy();
        expect(viewManager.views.size).toBe(0);
        expect(view.release).toBeCalledTimes(2);
    });
})