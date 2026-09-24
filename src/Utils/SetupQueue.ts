export type SetupTaskRunner = () => Promise<void>;

type SetupTask = {
    id: string;
    priority: () => number;
    seq: number;
    runner: SetupTaskRunner;
    resolve: () => void;
    reject: (error: unknown) => void;
    canStart?: () => boolean;
};

/**
 * Serial task queue with dynamic priorities.
 *
 * Tasks hold one scheduling lease at a time. The next task is picked by ascending
 * `priority()` (insertion order breaks ties), and the priority function is
 * evaluated at pick time, so not-yet-started tasks can be reordered when
 * e.g. the focused app changes. yieldSetup() releases a setup lease without
 * cancelling its physical work or settling its completion Promise.
 */
export class SetupQueue {
    private tasks: SetupTask[] = [];
    private running = false;
    private active?: { task: SetupTask; startedAt: number };
    private seq = 0;
    private idlePromise?: Promise<void>;
    private idleResolve?: () => void;
    /** Scheduling ownership changed. Never invoke observers inside pump(). */
    public onChange?: () => void;

    private notifyChange(): void {
        void Promise.resolve().then(() => this.onChange?.());
    }

    public push(
        id: string,
        priority: () => number,
        runner: SetupTaskRunner,
        canStart?: () => boolean
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.tasks.push({ id, priority, seq: this.seq++, runner, resolve, reject, canStart });
            this.pump();
        });
    }

    public get current(): { id: string; startedAt: number } | undefined {
        return this.active && { id: this.active.task.id, startedAt: this.active.startedAt };
    }

    /** Release only scheduling ownership. The caller's real completion stays pending. */
    public yieldSetup(): void {
        if (!this.active?.task.id.startsWith("setup:")) return;
        this.active = undefined;
        this.running = false;
        this.pump();
        this.notifyChange();
    }

    public resume(): void {
        this.pump();
    }

    /** Remove a not-yet-started task. Returns whether a pending task was removed. */
    public cancel(id: string): boolean {
        const index = this.tasks.findIndex(task => task.id === id);
        if (index < 0) return false;
        const [task] = this.tasks.splice(index, 1);
        task.reject(new Error(`[WindowManager]: setup task cancelled, id: ${id}`));
        return true;
    }

    /** Reject and drop every pending task. The running task is not interrupted. */
    public clear(): void {
        const pending = this.tasks.splice(0, this.tasks.length);
        for (const task of pending) {
            task.reject(new Error(`[WindowManager]: setup task cleared, id: ${task.id}`));
        }
    }

    /** Number of tasks waiting to start (the running task is not counted). */
    public get size(): number {
        return this.tasks.length;
    }

    /** Resolves when no queued task or active lease remains; yielded work may still run. */
    public whenIdle(): Promise<void> {
        if (!this.running && this.tasks.length === 0) {
            return Promise.resolve();
        }
        if (!this.idlePromise) {
            this.idlePromise = new Promise<void>(resolve => {
                this.idleResolve = resolve;
            });
        }
        return this.idlePromise;
    }

    private pump(): void {
        if (this.running) return;
        const task = this.pickNext();
        if (!task) {
            if (this.tasks.length === 0 && this.idleResolve) {
                const resolve = this.idleResolve;
                this.idleResolve = undefined;
                this.idlePromise = undefined;
                resolve();
            }
            return;
        }
        this.running = true;
        const lease = { task, startedAt: Date.now() };
        this.active = lease;
        this.notifyChange();
        void (async () => {
            try {
                await task.runner();
                task.resolve();
            } catch (error) {
                task.reject(error);
            } finally {
                if (this.active === lease) {
                    this.active = undefined;
                    this.running = false;
                    this.pump();
                    this.notifyChange();
                }
            }
        })();
    }

    private pickNext(): SetupTask | undefined {
        if (this.tasks.length === 0) return undefined;
        let best = -1;
        let bestPriority = Infinity;
        for (let i = 0; i < this.tasks.length; i += 1) {
            if (this.tasks[i].canStart && !this.tasks[i].canStart!()) continue;
            const priority = this.tasks[i].priority();
            if (
                best < 0 ||
                priority < bestPriority ||
                (priority === bestPriority && this.tasks[i].seq < this.tasks[best].seq)
            ) {
                best = i;
                bestPriority = priority;
            }
        }
        if (best < 0) return undefined;
        const [task] = this.tasks.splice(best, 1);
        return task;
    }
}
