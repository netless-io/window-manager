import { RoomPhase } from "white-web-sdk";
import type { Room } from "white-web-sdk";

const resizeObserverLoopErrRe = /^ResizeObserver loop limit exceeded/;

Cypress.on("uncaught:exception", err => {
    if (resizeObserverLoopErrRe.test(err.message)) {
        return false;
    }
});

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


    it("光标 dom 存在", () => {
        cy.window().then((window: any) => {
            const room = window.room as Room;
            cy.get(".netless-window-manager-cursor-mid").should("have.length", 1);
            expect(room.state.roomMembers.length).to.be.gte(2);
        });
    })
});

export {};
