import type { WindowManager } from "../../../dist";
import "./common";

describe("redo undo 切换", () => {
    before(() => {
        cy.visit("/");
        cy.wait(8000);
    });

    afterEach(() => {
        cy.wait(1000);
    });

    it("获取 redo undo steps", () => {
        cy.window().then(async (window: any) => {
            const manager = window.manager as WindowManager;
            const room = window.room;
            expect(room).to.be.a("object");
            expect(manager).to.be.a("object");

            expect(manager.canRedoSteps).to.be.equal(0);
            expect(manager.canUndoSteps).to.be.equal(0);
        });
    });
});

export {}
