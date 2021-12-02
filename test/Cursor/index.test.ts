import { AppManager } from "../../src/AppManager";
import { CursorManager } from "../../src/Cursor"

describe("CursorManager", () => {
    const manager = {
        displayer: {
            observerId: jest.fn(),
        }
    } as unknown as AppManager;
    
    test("constructor", () => {
        const cursor = new CursorManager(manager);

        expect(cursor).toBeDefined();
    });
});
