import type { Room } from "white-web-sdk";
import type { WindowManager } from "../../../dist";

const resizeObserverLoopErrRe = /^ResizeObserver loop limit exceeded/;

Cypress.on("uncaught:exception", err => {
    if (resizeObserverLoopErrRe.test(err.message)) {
        return false;
    }
});

describe("切换 MainViewScene", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    it("set index 0", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");

            cy.wrap(null).then(() => manager.setMainViewSceneIndex(0))

            expect(manager.mainViewSceneIndex).to.be.equal(0);
            expect(manager.mainView.focusScenePath).to.be.equal("/init");
        });
    });

    it("set scenePath update sceneIndex", () => {
        cy.window().then((window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");
        
            manager.setMainViewSceneIndex(1);

            cy.wait(1000).then(() => {
                expect(manager.mainViewSceneIndex).to.be.equal(1);
            });

            manager.setMainViewScenePath("/");

            cy.wait(1000).then(() => {
                expect(manager.mainViewSceneIndex).to.be.equal(0);
            });
            
        });
    });

    it("remove scenes update mainView scenePath", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room as Room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");
            room.putScenes("/", [{}]);
            
            cy.wrap(null).then(() => manager.setMainViewSceneIndex(1));

            const focusScenePath = manager.mainView.focusScenePath;
            if (focusScenePath) {
                room.removeScenes(focusScenePath);
                expect(manager.mainViewSceneIndex).to.be.equal(0);
                expect(manager.mainView.focusScenePath).to.be.equal("/init");
            } else {
                expect(true).to.be.false;
            }
        });
    });
});

export {};
