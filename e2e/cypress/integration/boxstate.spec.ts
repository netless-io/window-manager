import { TELE_BOX_STATE } from "@netless/telebox-insider";
import type { WindowManager } from "../../../dist";

const resizeObserverLoopErrRe = /^ResizeObserver loop limit exceeded/;

Cypress.on("uncaught:exception", err => {
    if (resizeObserverLoopErrRe.test(err.message)) {
        return false;
    }
});

describe("boxState", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const apps = manager.queryAll();
            if (apps.length === 0) {
                await manager.addApp({
                    kind: "HelloWorld",
                    options: {
                        scenePath: "/helloworld1",
                    },
                });
            }
        });
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
