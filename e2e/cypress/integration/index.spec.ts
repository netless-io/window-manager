import { RoomPhase } from "white-web-sdk";

describe("正常流程", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    it("挂载成功", () => {
        cy.window().then((window: any) => {
            const manager = window.manager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(room.phase).to.be.equal(RoomPhase.Connected);
            expect(manager).to.be.a("object");
        });
    });

    it("插入一个 APP", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const appId = await manager.addApp({
                kind: "HelloWorld",
                options: {
                    scenePath: "/helloworld1",
                },
            });
            cy.wait(1000).then(() => {
                expect(appId).to.be.string;
                cy.get(".telebox-box").should("have.length", 1);
                expect(manager.queryAll().length).to.be.equal(1);
            });
        });
    });

    it("删除所有 APP", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager;
            const apps = manager.queryAll();
            for (const app of apps) {
                await app.close();
            }
            expect(manager.queryAll().length).to.be.equal(0);
            cy.get(".telebox-box").should("have.length", 0);
        });
    });
});

export {};
