import { RoomPhase } from "white-web-sdk";
import type { Room } from "white-web-sdk";

describe("光标", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    it("room members 数据正确", () => {
        cy.window().then((window: any) => {
            const manager = window.manager;
            const room = window.room as Room;
            expect(room.phase).to.be.equal(RoomPhase.Connected);
            expect(manager).to.be.a("object");
            expect(room.isWritable).to.be.true;
            cy.get(".netless-whiteboard").should("have.length", 1);
            expect(room.state.roomMembers.length).to.be.gte(2);
        });
    });

    // 光标实现方式修改, 不再有默认的 dom
    // it("光标 dom 存在", () => {
    //     cy.window().then((window: any) => {
    //         const room = window.room as Room;
    //         cy.get(".netless-window-manager-cursor-mid").should("have.length", 1);
    //         expect(room.state.roomMembers.length).to.be.gte(2);
    //     });
    // })
});

export {};
