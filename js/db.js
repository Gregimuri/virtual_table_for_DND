'use strict';

const VTTDB = (() => {
  const DB_NAME = 'dnd-virtual-table';
  const DB_VERSION = 2;
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('maps')) {
          db.createObjectStore('maps', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs');
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opening = null;
        reject(request.error);
      };
    });
    return opening;
  }

  function withStore(name, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      let value;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(result);
      };
      tx.oncomplete = () => finish(null, value);
      tx.onerror = () => finish(tx.error || new Error('idb'));
      tx.onabort = () => finish(tx.error || new Error('abort'));
      try {
        const request = fn(tx.objectStore(name));
        request.onsuccess = () => {
          value = request.result;
        };
      } catch (error) {
        finish(error);
      }
    }));
  }

  function emptyScene() {
    return {
      version: 1,
      rev: 0,
      mapOrder: [],
      currentMapId: null,
      tableMapId: null,
      drawings: {},
      fog: {},
      tokens: [],
      nextZ: 1,
      pixelated: false,
      grids: {},
    };
  }

  return {
    emptyScene,
    putMap(map) {
      return withStore('maps', 'readwrite', (store) => store.put(map));
    },
    getMap(id) {
      return withStore('maps', 'readonly', (store) => store.get(id));
    },
    deleteMap(id) {
      return withStore('maps', 'readwrite', (store) => store.delete(id));
    },
    allMaps() {
      return withStore('maps', 'readonly', (store) => store.getAll());
    },
    putBlob(id, blob) {
      return withStore('blobs', 'readwrite', (store) => store.put(blob, id));
    },
    getBlob(id) {
      return withStore('blobs', 'readonly', (store) => store.get(id));
    },
    deleteBlob(id) {
      return withStore('blobs', 'readwrite', (store) => store.delete(id));
    },
    getScene() {
      return withStore('kv', 'readonly', (store) => store.get('scene'));
    },
    putScene(scene) {
      return withStore('kv', 'readwrite', (store) => store.put(scene, 'scene'));
    },
    getKv(key) {
      return withStore('kv', 'readonly', (store) => store.get(key));
    },
    putKv(key, value) {
      return withStore('kv', 'readwrite', (store) => store.put(value, key));
    },
    deleteKv(key) {
      return withStore('kv', 'readwrite', (store) => store.delete(key));
    },
    putProject(project) {
      return withStore('projects', 'readwrite', (store) => store.put(project));
    },
    getProject(id) {
      return withStore('projects', 'readonly', (store) => store.get(id));
    },
    deleteProject(id) {
      return withStore('projects', 'readwrite', (store) => store.delete(id));
    },
    allProjects() {
      return withStore('projects', 'readonly', (store) => store.getAll());
    },
  };
})();
