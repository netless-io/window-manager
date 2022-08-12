import type { AppRegister } from "./index";

const DatabaseName = "__WindowManagerAppCache";

let db: IDBDatabase;
let store: IDBObjectStore;

export type Item = {
    kind: string;
    url: string;
    sourceCode: string;
}

export const initDb = async (appRegister: AppRegister) => {
    db = await createDb();
    const items = await queryAll(db);
    items.forEach(item => {
        appRegister.downloaded.set(item.kind, item.url);
    });
}

export const setItem = (kind: string, url: string, val: any) => {
    if (!db) return;
    return addRecord(db, { kind, url, sourceCode: val })
};

export const getItem = async (kind: string): Promise<Item | null> => {
    if (!db) return null;
    return await query(db, kind);
};

export const removeItem = (key: string) => {
    if (!db) return;
    return deleteRecord(db, key);
};

export const getAll = () => {
    if (!db) return;
    return queryAll(db);
}

function createDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DatabaseName, 2);
        request.onerror = (e) => {
            reject(e);
        }

        request.onupgradeneeded = (event: any) => {
            const db = event.target.result as IDBDatabase;
            if (!db.objectStoreNames.contains("apps")) {
                store = db.createObjectStore("apps", { keyPath: "kind" });
                store.createIndex("kind", "kind", { unique: true });
            }
        }

        request.onsuccess = () => {
            const db = request.result;
            resolve(db);
        }
    })
}

function query<T>(db: IDBDatabase, val: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
        const index = db.transaction(["apps"]).objectStore("apps").index("kind");
        const request = index.get(val);
        request.onerror = (e) => reject(e);
        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result);
            } else {
                resolve(null);
            }
        }
    })
}

function queryAll(db: IDBDatabase): Promise<Item[]> {
    return new Promise((resolve, reject) => {
        const index = db.transaction(["apps"]).objectStore("apps").index("kind");
        const request = index.getAll();
        request.onerror = e => reject(e);
        request.onsuccess = () => resolve(request.result);
    });
}

function addRecord(db: IDBDatabase, payload: any): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = db.transaction(["apps"], "readwrite").objectStore("apps").add(payload);
        request.onsuccess = () => resolve();
        request.onerror = () => reject();
    })
}

function deleteRecord(db: IDBDatabase, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = db.transaction(["apps"], "readwrite").objectStore("apps").delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject();
    })
}
