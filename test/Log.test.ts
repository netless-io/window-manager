import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "white-web-sdk";
import {
    ArgusLog,
    createManagedRoomLogger,
    LocalConsole,
    ScopedAppLogger,
} from "../src/Utils/log";

vi.mock("../src/index", () => ({ WindowManager: { debug: false } }));

function createRoomLogger() {
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        withContext: vi.fn(),
    };
    logger.withContext.mockReturnValue(logger);
    return logger;
}

describe("managed WindowManager logging", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("redacts sensitive values and safely serializes logger arguments", () => {
        const roomLogger = createRoomLogger();
        const logger = createManagedRoomLogger(roomLogger as unknown as Logger);
        const circular: Record<string, unknown> = { roomToken: "secret" };
        circular.self = circular;

        logger.info("camera", circular, "https://example.com/a?token=secret&x=1");

        const message = roomLogger.info.mock.calls[0][0] as string;
        expect(message).toContain('"roomToken":"[REDACTED]"');
        expect(message).toContain("[Circular]");
        expect(message).toContain("https://example.com/a?[REDACTED]");
        expect(message).not.toContain("secret");
    });

    it("does not let Room logger failures change the caller control flow", () => {
        const roomLogger = createRoomLogger();
        roomLogger.error.mockImplementation(() => {
            throw new Error("logger unavailable");
        });
        const logger = createManagedRoomLogger(roomLogger as unknown as Logger);

        expect(() => logger.error("original operation failed")).not.toThrow();
    });

    it("emits errors immediately and debounces info independently by event", () => {
        vi.useFakeTimers();
        const roomLogger = createRoomLogger();
        const logger = new ScopedAppLogger(
            createManagedRoomLogger(roomLogger as unknown as Logger),
            "camera",
            { kind: "Presentation", appId: "app-1", uid: "uid-1" },
            { debounceTime: 300, maxWaitTime: 2000 }
        );

        logger.debouncedInfo("moveCamera", { scale: 1 });
        logger.debouncedInfo("initialize", { scale: 2 });
        logger.debouncedInfo("moveCamera", { scale: 3 });
        logger.error("moveCamera.failed", new Error("not writable"), { scale: 4 });

        expect(roomLogger.error).toHaveBeenCalledOnce();
        expect(roomLogger.info).not.toHaveBeenCalled();
        vi.advanceTimersByTime(300);
        expect(roomLogger.info).toHaveBeenCalledTimes(2);
        const messages = roomLogger.info.mock.calls.map(call => call[0] as string).join("\n");
        expect(messages).toContain('"event":"moveCamera"');
        expect(messages).toContain('"scale":3');
        expect(messages).toContain('"event":"initialize"');
    });

    it("uses maxWait during continuous calls and flushes pending logs on destroy", () => {
        vi.useFakeTimers();
        const roomLogger = createRoomLogger();
        const logger = new ScopedAppLogger(
            createManagedRoomLogger(roomLogger as unknown as Logger),
            "camera",
            { kind: "Presentation", appId: "app-1" },
            { debounceTime: 300, maxWaitTime: 1000 }
        );

        for (let scale = 1; scale <= 5; scale++) {
            logger.debouncedInfo("moveCamera", { scale });
            vi.advanceTimersByTime(200);
        }
        expect(roomLogger.info).toHaveBeenCalledOnce();
        expect(roomLogger.info.mock.calls[0][0]).toContain('"scale":5');

        logger.debouncedInfo("moveCamera", { scale: 6 });
        logger.destroy();
        expect(roomLogger.info).toHaveBeenCalledTimes(2);
        expect(roomLogger.info.mock.calls[1][0]).toContain('"scale":6');
    });

    it("clamps Room logger debounce timers to 300ms", () => {
        vi.useFakeTimers();
        const roomLogger = createRoomLogger();
        const managedLogger = createManagedRoomLogger(roomLogger as unknown as Logger);
        const appLogger = new ScopedAppLogger(
            managedLogger,
            "camera",
            { kind: "Presentation", appId: "app-1" },
            { debounceTime: 100 }
        );
        const argusLogger = new ArgusLog(managedLogger, "mainView", 200);

        appLogger.debouncedInfo("moveCamera", { scale: 2 });
        argusLogger.log("final camera");
        vi.advanceTimersByTime(299);
        expect(roomLogger.info).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(roomLogger.info).toHaveBeenCalledTimes(2);
        appLogger.destroy();
        argusLogger.destroy();
    });

    it("keeps LocalConsole available for debounced local debugging", () => {
        vi.useFakeTimers();
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const localConsole = new LocalConsole("camera", 100);

        localConsole.log("first");
        localConsole.log("final");
        vi.advanceTimersByTime(99);
        expect(consoleLog).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(consoleLog).toHaveBeenCalledOnce();
        expect(consoleLog).toHaveBeenCalledWith("[window-manager][camera]: final");
        localConsole.destroy();
    });
});
