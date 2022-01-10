export type StorageEventListener<T> = (event: T) => void;

export class StorageEvent<TMessage> {
  listeners = new Set<StorageEventListener<TMessage>>();

  get length(): number {
    return this.listeners.size;
  }

  dispatch(message: TMessage): void {
    this.listeners.forEach(callback => callback(message));
  }

  addListener(listener: StorageEventListener<TMessage>): void {
    this.listeners.add(listener);
  }

  removeListener(listener: StorageEventListener<TMessage>): void {
    this.listeners.delete(listener);
  }
}
