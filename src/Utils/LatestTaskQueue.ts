type Task<T> = {
    value: T;
    run: () => Promise<void>;
    done: () => void;
    startedAt: number;
};

/** One pending intent, independent of the lifetime of work that has yielded. */
export class LatestTaskQueue<T> {
    private pending?: Task<T>;
    private active?: Task<T>;
    private timer?: ReturnType<typeof setTimeout>;
    private disposed = false;

    constructor(
        private options: {
            runnable: (value: T) => boolean;
            canYield: (current: T, next: T) => boolean;
            startedAt: (current: T) => number | undefined;
            yield: (current: T, next: T) => void;
            /** Actual work may have started outside this focus queue. */
            blocker?: (
                next: T
            ) => { startedAt: number; canYield: boolean; yield: () => void } | undefined;
            error: (error: unknown) => void;
            timeout: number;
        }
    ) {}

    public push(value: T, run: () => Promise<void>): Promise<void> {
        if (this.disposed) return Promise.resolve();
        this.pending?.done();
        const completion = new Promise<void>(done => {
            this.pending = { value, run, done, startedAt: 0 };
        });
        this.wake();
        return completion;
    }

    /** Cancel only a not-yet-started matching intent; active work keeps its lease. */
    public cancelPending(matches: (value: T) => boolean): boolean {
        const pending = this.pending;
        if (!pending || !matches(pending.value)) return false;
        this.pending = undefined;
        pending.done();
        this.wake();
        return true;
    }

    public wake(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        const pending = this.pending;
        const candidate = pending ?? this.active;
        if (this.disposed || !candidate || !this.options.runnable(candidate.value)) return;
        // Also inspect an active intent: a direct setup may acquire the real
        // lease after this intent was taken, before it enqueues its own setup.
        const blocker = this.options.blocker?.(candidate.value);
        if (blocker) {
            if (!blocker.canYield) return;
            const remaining = this.options.timeout - (Date.now() - blocker.startedAt);
            if (remaining > 0) {
                this.timer = setTimeout(() => this.wake(), remaining);
                return;
            }
            blocker.yield();
            // Yield may start a mandatory cleanup or another setup. Re-arbitrate
            // that lease before consuming pending; never run through a cleanup.
            this.wake();
            return;
        }
        if (!pending) return;
        const active = this.active;
        if (active) {
            if (!this.options.canYield(active.value, pending.value)) return;
            const startedAt = this.options.startedAt(active.value) ?? active.startedAt;
            const remaining = this.options.timeout - (Date.now() - startedAt);
            if (remaining > 0) {
                this.timer = setTimeout(() => this.wake(), remaining);
                return;
            }
            this.options.yield(active.value, pending.value);
            active.done();
            this.active = undefined;
        }
        // Re-read after yielding; a synchronous callback can replace pending.
        const task = this.pending;
        if (!task || !this.options.runnable(task.value)) return;
        this.pending = undefined;
        this.active = task;
        task.startedAt = Date.now();
        const finish = () => {
            task.done();
            // A late completion must not release a newer task's slot.
            if (this.active === task) {
                this.active = undefined;
                this.wake();
            }
        };
        void Promise.resolve().then(task.run).catch(this.options.error).then(finish, finish);
    }

    public dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
        this.pending?.done();
        this.active?.done();
        this.pending = this.active = undefined;
    }
}
