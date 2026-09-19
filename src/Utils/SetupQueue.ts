export type SetupTaskRunner = () => Promise<void>;

type SetupTask = {
    id: string;
    priority: () => number;
    seq: number;
    runner: SetupTaskRunner;
    resolve: () => void;
    reject: (error: unknown) => void;
};

/**
 * Serial task queue with dynamic priorities.
 *
 * Tasks run strictly one at a time. The next task is picked by ascending
 * `priority()` (insertion order breaks ties), and the priority function is
 * evaluated at pick time, so not-yet-started tasks can be reordered when
 * e.g. the focused app changes. Started tasks are never interrupted.
 */
export class SetupQueue {
    private tasks: SetupTask[] = [];
    private running = false;
    private seq = 0;
    private idlePromise?: Promise<void>;
    private idleResolve?: () => void;

    public push(id: string, priority: () => number, runner: SetupTaskRunner): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.tasks.push({ id, priority, seq: this.seq++, runner, resolve, reject });
            this.pump();
        });
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

    /** Resolves when the queue is empty and the running task has finished. */
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
            if (this.idleResolve) {
                const resolve = this.idleResolve;
                this.idleResolve = undefined;
                this.idlePromise = undefined;
                resolve();
            }
            return;
        }
        this.running = true;
        void (async () => {
            try {
                await task.runner();
                task.resolve();
            } catch (error) {
                task.reject(error);
            } finally {
                this.running = false;
                this.pump();
            }
        })();
    }

    private pickNext(): SetupTask | undefined {
        if (this.tasks.length === 0) return undefined;
        let best = 0;
        let bestPriority = this.tasks[0].priority();
        for (let i = 1; i < this.tasks.length; i += 1) {
            const priority = this.tasks[i].priority();
            if (
                priority < bestPriority ||
                (priority === bestPriority && this.tasks[i].seq < this.tasks[best].seq)
            ) {
                best = i;
                bestPriority = priority;
            }
        }
        const [task] = this.tasks.splice(best, 1);
        return task;
    }
}
