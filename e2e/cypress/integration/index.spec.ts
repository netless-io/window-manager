import { TELE_BOX_STATE } from "@netless/telebox-insider";
import { RoomPhase, ViewVisionMode } from "white-web-sdk";

describe("正常流程", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
    })

    afterEach(() => {
        cy.wait(1000)
    })
    
    it("挂载成功", () => {
        cy.window().then((window: any) => {
            const manager = window.manager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(room.phase).to.be.equal(RoomPhase.Connected);
            expect(manager).to.be.a("object");
        })
    })

    it("插入一个 APP", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const appId = await manager.addApp({
                kind: "HelloWorld",
                options: {
                    scenePath: "/helloworld1"
                }
            });
            cy.wait(1000).then(() => {
                expect(appId).to.be.string;
                cy.get(".telebox-box").should("have.length", 1);
                expect(manager.queryAll().length).to.be.equal(1);
            })
        });
    })

    it("切换可写白板", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            const app = apps[0];
            cy.get(".netless-window-manager-main-view").click({ force: true })
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-content-wrap`).click({ force: true });
        });
    })

    it("最大化", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            const app = apps[0];
            expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-titlebar-icon-maximize`).click({ force: true });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Maximized);
            });
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-titlebar-icon-maximize`).click({ force: true });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            });
        })
    })

    it("最小化", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            const app = apps[0];
            expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            cy.get(`[data-tele-box-i-d=${app.id}] .telebox-titlebar-icon-minimize`).click({ force: true });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Minimized);
                cy.get(".telebox-collector.telebox-collector-visible").should("have.length", 1);
            });
            cy.get(`.telebox-collector.telebox-collector-visible`).click({ force: true });
            cy.wait(500).then(() => {
                expect(manager.boxState).to.be.equal(TELE_BOX_STATE.Normal);
            });
        })
    })

    it("删除所有 APP", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            for (const app of apps) {
                await app.close();
            }
            expect(manager.queryAll().length).to.be.equal(0);
            cy.get(".telebox-box").should("have.length", 0);
        })
    })
})

export {};
