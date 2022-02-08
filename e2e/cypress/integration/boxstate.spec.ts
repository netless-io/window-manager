import { TELE_BOX_STATE } from "@netless/telebox-insider";
import type { WindowManager } from "../../../dist";
import { HelloWorldApp } from "../../../example/helloworld-app";
import sinon from "sinon";
import "./common";

describe("boxState", () => {
    before(() => {
        sinon.restore();
        cy.visit("/");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    after(() => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const apps = manager.queryAll();
            if (apps.length > 0) {
                apps.forEach(app => {
                    manager.closeApp(app.id);
                });
            }
        });
    });

    it("添加一个 App", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const WindowManager = window.WindowManager;
            const onFocus = sinon.spy();
            const onCreated = sinon.spy();

            WindowManager.register({
                kind: "HelloWorld",
                src: HelloWorldApp,
                addHooks: (emitter: any) => {
                    emitter.on("focus", () => onFocus());
                    emitter.on("created", () => onCreated());
                },
            });

            const apps = manager.queryAll();
            if (apps.length === 0) {
                cy.wrap(null).then(() => {
                    return manager.addApp({
                        kind: "HelloWorld",
                        options: {
                            scenePath: "/helloworld1",
                        },
                    });
                });
                cy.wait(100).then(() => {
                    expect(onCreated.calledOnce).to.be.true;
                    expect(onFocus.calledOnce).to.be.true;
                });
            }
        });
    });

    it("最大化", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            const app = apps[0];
            expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-titlebar-icon-maximize`).click({
                force: true,
            });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Maximized);
            });
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-titlebar-icon-maximize`).click({
                force: true,
            });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            });
        });
    });

    it("最小化", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            const app = apps[0];
            expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-titlebar-icon-minimize`).click({
                force: true,
            });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Minimized);
                cy.get(".telebox-collector.telebox-collector-visible").should("have.length", 1);
            });
        });
    });

    it("从最小化恢复 focus topBox", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const apps = manager.queryAll();
            const app = apps[0];
            expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Minimized);
            cy.get(`.telebox-collector.telebox-collector-visible`).click({ force: true });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
                expect(manager.focused).to.be.equal(app.id);
            });
        });
    });
});

export {};
