/* ============================================================
   BANCO DE DADOS LOCAL (IndexedDB)
   Guarda listas, tarefas (com as imagens em base64) e config.
   ============================================================ */
const DB_NAME = "checklistDB";
const DB_VERSION = 3;
let dbInstance = null;

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("lists")) {
        db.createObjectStore("lists", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("tasks")) {
        const ts = db.createObjectStore("tasks", { keyPath: "id" });
        ts.createIndex("listId", "listId", { unique: false });
      }
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("imageCache")) {
        db.createObjectStore("imageCache", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("pendingDeletes")) {
        db.createObjectStore("pendingDeletes", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDB() {
  if (!dbInstance) dbInstance = await dbOpen();
  return dbInstance;
}

export async function dbPut(storeName, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName], "readwrite");
    t.objectStore(storeName).put(value);
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
  });
}

export async function dbDelete(storeName, key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName], "readwrite");
    t.objectStore(storeName).delete(key);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

// Lê e grava na MESMA transação: ninguém consegue alterar o registro entre a
// leitura e a gravação. `mutador(atual)` recebe o registro atual (ou undefined
// se não existir) e devolve o novo valor para gravar, ou null/undefined para
// não mexer em nada. Usado para marcar "sincronizado" e para mesclar dados
// vindos da planilha sem passar por cima de uma edição feita no meio tempo.
export async function dbUpsert(storeName, key, mutador) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName], "readwrite");
    const store = t.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => {
      const novo = mutador(req.result);
      if (novo) store.put(novo);
    };
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

// Apaga um registro só se `predicado(atual)` for verdadeiro, checando e
// apagando na mesma transação.
export async function dbDeleteSe(storeName, key, predicado) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName], "readwrite");
    const store = t.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => {
      if (req.result && predicado(req.result)) store.delete(key);
    };
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

// Devolve só os registros que passam no filtro, lendo um de cada vez — os
// que não passam (e as fotos pesadas que carregam) não ficam na memória.
export async function dbGetWhere(storeName, predicado) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const saida = [];
    const t = db.transaction([storeName]);
    const req = t.objectStore(storeName).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (predicado(cur.value)) saida.push(cur.value);
      cur.continue();
    };
    t.oncomplete = () => resolve(saida);
    t.onerror = () => reject(t.error);
  });
}

// Lê todos os registros, mas guarda só uma versão enxuta de cada um
// (`projecao`) — útil para conferir ids/flags sem carregar as fotos.
export async function dbMapAll(storeName, projecao) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const saida = [];
    const t = db.transaction([storeName]);
    const req = t.objectStore(storeName).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      saida.push(projecao(cur.value));
      cur.continue();
    };
    t.oncomplete = () => resolve(saida);
    t.onerror = () => reject(t.error);
  });
}

export async function dbGet(storeName, key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName]);
    const req = t.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName]);
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAllByIndex(storeName, indexName, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([storeName]);
    const idx = t.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
