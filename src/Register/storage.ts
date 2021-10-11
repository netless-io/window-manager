const DatabaseName = "__WindowManagerAppCache";

let db: IDBDatabase;
let store: IDBObjectStore;

export const initDb = async () => {
    db = await createDb();
}

export const setItem = (key: string, val: any) => {
    if (!db) return;
    return addRecord(db, { kind: key, sourceCode: val })
};

export const getItem = async (key: string): Promise<string | null> => {
    if (!db) return null;
    return await query(db, key);
};

export const removeItem = (key: string) => {
    if (!db) return;
    return deleteRecord(db, key);
};

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
