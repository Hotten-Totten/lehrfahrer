// ═════════════════════════════════════════════════════════════════════════════
// DEBUG HELPERS – Globale Debug-Befehle für Browser Console
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Löscht die gesamte IndexedDB (alle Stores) und lädt die Seite neu
 * Aufruf in Console: window.DEBUG_resetDownloadCache()
 */
window.DEBUG_resetDownloadCache = async function() {
  console.log('🧹 DEBUG: Resetting entire IndexedDB...');
  
  try {
    // Lösche die komplette Datenbank
    const deleteReq = indexedDB.deleteDatabase('lehrfahrer-offline');
    
    deleteReq.onsuccess = () => {
      console.log('✓ IndexedDB gelöscht!');
      console.log('🔄 Seite wird neu geladen...');
      // Kurze Verzögerung, damit Console-Nachricht noch angezeigt wird
      setTimeout(() => {
        window.location.reload();
      }, 500);
    };
    
    deleteReq.onerror = () => {
      console.error('❌ Fehler beim Löschen der IndexedDB:', deleteReq.error);
    };
    
    deleteReq.onblocked = () => {
      console.warn('⚠️ IndexedDB gelöscht (blocked event)');
      setTimeout(() => window.location.reload(), 500);
    };
  } catch (err) {
    console.error('❌ Fehler:', err);
  }
};

/**
 * Zeigt aktuelle Cache-Status an
 * Aufruf in Console: window.DEBUG_showCacheStatus()
 */
window.DEBUG_showCacheStatus = async function() {
  console.log('📊 DEBUG: Cache Status');
  
  try {
    // Öffne DB
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('lehrfahrer-offline', 2);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
    
    // Lese linesCatalog
    const catalogTx = db.transaction('linesCatalog', 'readonly');
    const catalogReq = catalogTx.objectStore('linesCatalog').getAll();
    
    catalogReq.onsuccess = () => {
      const catalog = catalogReq.result || [];
      console.log(`  📦 Cached lines: ${catalog.length}`);
      catalog.forEach((line, idx) => {
        console.log(`    ${idx + 1}. ${line.id} (${line.lineName})`);
      });
    };
  } catch (err) {
    console.error('❌ Fehler:', err);
  }
};

/**
 * Zeigt alle IndexedDB-Stores an
 * Aufruf in Console: window.DEBUG_listStores()
 */
window.DEBUG_listStores = async function() {
  console.log('📋 DEBUG: IndexedDB Stores');
  
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('lehrfahrer-offline', 2);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
    
    const stores = ['routes', 'linesCatalog', 'linesData', 'linesGPX'];
    
    for (const storeName of stores) {
      if (!db.objectStoreNames.contains(storeName)) {
        console.log(`  ❌ ${storeName}: NOT FOUND`);
        continue;
      }
      
      const tx = db.transaction(storeName, 'readonly');
      const countReq = tx.objectStore(storeName).count();
      
      countReq.onsuccess = () => {
        console.log(`  ✓ ${storeName}: ${countReq.result} items`);
      };
    }
  } catch (err) {
    console.error('❌ Fehler:', err);
  }
};

console.log('✓ Debug-Befehle geladen:');
console.log('  - window.DEBUG_resetDownloadCache() – IndexedDB löschen + Reload');
console.log('  - window.DEBUG_showCacheStatus() – Cache anzeigen');
console.log('  - window.DEBUG_listStores() – Alle Stores auflisten');
