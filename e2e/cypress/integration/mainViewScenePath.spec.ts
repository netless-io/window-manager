import type { Room } from "white-web-sdk";
import type { WindowManager } from "../../../dist";
import "./common";

describe("切换 MainViewScene", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    it("设置 MainViewSceneIndex", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");

            cy.wrap(null).then(() => manager.setMainViewSceneIndex(0));

            expect(manager.mainViewSceneIndex).to.be.equal(0);
            expect(manager.mainView.focusScenePath).to.be.equal("/init");
        });
    });

    it("设置 mainViewScenePath 更新 mainViewSceneIndex", () => {
        cy.window().then((window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");

            cy.wrap(null).then(() => room.putScenes("/", [{}]));
            cy.wrap(null).then(() => manager.setMainViewSceneIndex(1));

            cy.wait(1000).then(() => {
                expect(manager.mainViewSceneIndex).to.be.equal(1);
            });

            cy.wrap(null).then(() => manager.setMainViewScenePath("/"));

            cy.wait(1000).then(() => {
                expect(manager.mainViewSceneIndex).to.be.equal(0);
            });
        });
    });

    it("删除 scenes 更新 sceneIndex", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room as Room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");
            room.putScenes("/", [{}]);

            cy.wrap(null).then(() => manager.setMainViewSceneIndex(1));

            cy.wait(1000).then(() => {
                const focusScenePath = manager.mainView.focusScenePath;
                if (focusScenePath) {
                    expect(focusScenePath).to.be.not.equal("/init");
                    cy.wrap(null).then(() => room.removeScenes(focusScenePath));
                    cy.wait(1000).then(() => {
                        expect(manager.mainViewSceneIndex).to.be.equal(0);
                        expect(manager.mainView.focusScenePath).to.be.equal("/init");
                    });
                } else {
                    expect(true).to.be.false;
                }
            });
        });
    });
});

export {};
