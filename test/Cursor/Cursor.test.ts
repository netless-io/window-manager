import { View } from "white-web-sdk";
import { CursorContext } from "../../src/Cursor";
import { Cursor } from "../../src/Cursor/Cursor"

describe("Cursor", () => {
    const mainView = {} as View;
    const memberId = "test";
    const context = {
        findMemberByUid: jest.fn(),
        onCursorChange: jest.fn(),
    } as unknown as CursorContext;

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("constructor", () => {
        jest.useFakeTimers();
        jest.spyOn(globalThis, "setTimeout");

        const cursor = new Cursor(mainView, memberId, context);

        expect(cursor).toBeDefined();
        expect(context.findMemberByUid).toBeCalledWith(memberId);
        expect(context.onCursorChange).toBeCalled();
        expect(setTimeout).toBeCalledTimes(1);
    });
});
