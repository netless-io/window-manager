import Dexie from "dexie";

const DatabaseName = "__WindowManagerAppCache";

const db = new Dexie(DatabaseName);

db.version(1).stores({
    apps: "kind, sourceCode",
});

export const getItem = async (key: string): Promise<string> => {
    return (await db.table("apps").get(key))?.sourceCode;
};

export const setItem = (key: string, val: any) => {
    return db.table("apps").add({ kind: key, sourceCode: val });
};

export const removeItem = (key: string) => {
    return db.table("apps").delete(key);
};
