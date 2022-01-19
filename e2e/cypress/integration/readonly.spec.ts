import { RoomPhase } from "white-web-sdk";
import type { Room } from "white-web-sdk";

describe("只读模式加入房间", () => {
    before(() => {
        cy.visit("/?isWritable=false");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    it("挂载成功", () => {
        cy.window().then((window: any) => {
            const manager = window.manager;
            const room = window.room as Room;
            expect(room.phase).to.be.equal(RoomPhase.Connected);
            expect(manager).to.be.a("object");
            expect(room.isWritable).to.be.false;
            cy.get(".netless-whiteboard").should("have.length", 1);
        });
    });
});

export {};
