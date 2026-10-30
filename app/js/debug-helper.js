// Browser-Konsole: Diagnose und gezielter Reset des App-Download-Caches.
// DB_NAME und die offene Verbindung stammen aus app.js; keine eigene DB-Version.

function debugAppDatabase() {
  if (typeof db !== 'undefined' && db?.name === DB_NAME) {
    return Promise.resolve({ connection: db, closeAfterUse: false });
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME); // Ohne Versionsangabe: vorhandene Version lesen.
    request.onsuccess = () => resolve({ connection: request.result, closeAfterUse: true });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('App-Datenbank ist durch einen anderen Tab gesperrt.'));
  });
}

async function debugWithAppDatabase(operation) {
  const { connection, closeAfterUse } = await debugAppDatabase();
  try {
    return await operation(connection);
  } finally {
    if (closeAfterUse) connection.close();
  }
}

function debugCountStore(connection, name) {
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction(name, 'readonly');
    const request = transaction.objectStore(name).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function debugSummarizeStore(connection, name) {
  if (!connection.objectStoreNames.contains(name)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const rows = [];
    const transaction = connection.transaction(name, 'readonly');
    const request = transaction.objectStore(name).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const record = cursor.value || {};
      const route = name === 'linesCatalog' ? record : (record.data || {});
      rows.push({
        id: String(record.id ?? record.key ?? cursor.key),
        line: String(route.lineName || route.line?.lineName || ''),
        stops: Array.isArray(route.stops) ? route.stops.length : null,
        routePoints: Array.isArray(route.routePoints) ? route.routePoints.length : null
      });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

window.DEBUG_showCacheStatus = async function() {
  try {
    const status = await debugWithAppDatabase(async connection => ({
      database: connection.name,
      version: connection.version,
      catalog: await debugSummarizeStore(connection, 'linesCatalog'),
      downloads: await debugSummarizeStore(connection, 'linesData'),
      offlineRoutes: await debugSummarizeStore(connection, 'routes')
    }));
    console.log('App-Download-Cache:', status);
    return status;
  } catch (error) {
    console.error('App-Download-Cache konnte nicht gelesen werden:', error);
    throw error;
  }
};

window.DEBUG_listStores = async function() {
  try {
    const stores = await debugWithAppDatabase(async connection => {
      const names = Array.from(connection.objectStoreNames);
      const counts = await Promise.all(names.map(async name => ({
        name, count: await debugCountStore(connection, name)
      })));
      return { database: connection.name, version: connection.version, stores: counts };
    });
    console.log('App-IndexedDB-Stores:', stores);
    return stores;
  } catch (error) {
    console.error('App-IndexedDB-Stores konnten nicht gelesen werden:', error);
    throw error;
  }
};

window.DEBUG_resetDownloadCache = async function() {
  try {
    // Die App-Verbindung muss vor deleteDatabase geschlossen werden.
    if (typeof db !== 'undefined' && db?.name === DB_NAME) {
      db.close();
      db = null;
    }
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn('App-Datenbank ist noch in einem anderen Tab geöffnet; bitte diesen Tab schließen.');
    });

    // API-Antworten können zusätzlich im PWA-Cache liegen; App-Shell und
    // andere Origin-Daten bleiben erhalten.
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      for (const name of names.filter(value => value.startsWith('lehrfahrer-api-'))) {
        if (!await caches.delete(name)) throw new Error(`API-Cache ${name} konnte nicht entfernt werden.`);
      }
    }
    console.log('App-Download-Cache gelöscht. Die App wird neu geladen.');
    window.location.reload();
    return true;
  } catch (error) {
    console.error('App-Download-Cache konnte nicht vollständig gelöscht werden:', error);
    throw error;
  }
};

console.log('Debug-Befehle: DEBUG_showCacheStatus(), DEBUG_listStores(), DEBUG_resetDownloadCache()');
