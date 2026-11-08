(function (root, factory) {
  'use strict';
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.LehrfahrerSupportCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMIT = 200;
  const OPERATIONS = new Set(["api/audit_read.php", "api/auth/account_mfa.php", "api/auth/account_passkeys.php", "api/auth/account_test.php", "api/auth/activate.php", "api/auth/login.php", "api/auth/logout.php", "api/auth/me.php", "api/auth/runtime.php", "api/city_settings.php", "api/create_city.php", "api/create_driver_documents.php", "api/delete_line.php", "api/download_driver_package.php", "api/download_line_gpx.php", "api/download_line_json.php", "api/download_line_pdf.php", "api/drivers.php", "api/fetch_stops.php", "api/import_gtfs.php", "api/import_vbb_line.php", "api/list_cities.php", "api/list_driver_packages.php", "api/list_lines.php", "api/load_catalog.php", "api/load_line.php", "api/manage_city.php", "api/manage_driver_package.php", "api/normalize_ghost_points.php", "api/pdf/PdfBranding.php", "api/pdf/PdfGenerator.php", "api/pdf/PdfHelpers.php", "api/pdf/PdfLayout.php", "api/pdf/PdfPreviewV2.php", "api/pdf/PdfSections.php", "api/pdf/preview_v2.php", "api/pdf/test_preview.php", "api/pdf/test_preview_v2.php", "api/regenerate_pdfs.php", "api/save_catalog.php", "api/save_gpx.php", "api/save_line.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/AttestationObject.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/AuthenticatorData.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/AndroidKey.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/AndroidSafetyNet.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/Apple.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/FormatBase.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/None.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/Packed.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/Tpm.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Attestation/Format/U2f.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/Binary/ByteBuffer.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/CBOR/CborDecoder.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/WebAuthn.php", "api/third_party/lbuchs-webauthn-v2.2.0/src/WebAuthnException.php", "api/trainings.php"]);
  const SOURCES = new Set(["app/js/app.js", "app/js/debug-helper.js", "app/js/local-bus-router.js", "app/js/local-bus-routing-storage.js", "app/js/map.js", "js/account-login.js", "js/activate.js", "js/audit.js", "js/editor.academy.js", "js/editor.api.js", "js/editor.autosave.js", "js/editor.dashboard.js", "js/editor.debug.js", "js/editor.dom.js", "js/editor.driverDocuments.js", "js/editor.events.js", "js/editor.fetchStops.js", "js/editor.help.js", "js/editor.history.js", "js/editor.identity.js", "js/editor.lineBrowser.js", "js/editor.linelogic.js", "js/editor.main.js", "js/editor.map-adapter.js", "js/editor.route.js", "js/editor.routing.js", "js/editor.search.js", "js/editor.selection.js", "js/editor.state.js", "js/editor.stops.js", "js/editor.test-drive.js", "js/editor.ui.js", "js/login.js", "js/tenant-cache-boundary.js"]);
  const KINDS = new Set(['page_open','http','network_error','application_rejected','json_error','script_error','resource_error','unhandled_rejection','console_error','console_warning','online','offline']);
  const AREAS = new Set(['editor','driver_app','account_login','legacy_login','audit','other']);
  const ERROR_TYPES = new Set(['Error','TypeError','ReferenceError','SyntaxError','RangeError','URIError','EvalError','AggregateError','AbortError','TimeoutError','SecurityError','NotAllowedError','NotFoundError','QuotaExceededError','NetworkError','InvalidStateError','UnknownError']);
  const safeErrorType = value => ERROR_TYPES.has(value) ? value : 'UnknownError';
  function operation(value, base) {
    try {
      const url = new URL(value, base);
      const app = new URL(base);
      if (url.origin !== app.origin) return 'external';
      const path = url.pathname.startsWith(app.pathname) ? url.pathname.slice(app.pathname.length) : '';
      return OPERATIONS.has(path) ? path : 'unknown';
    } catch (_) { return 'unknown'; }
  }
  function source(value, base) {
    try {
      const url = new URL(value, base), app = new URL(base);
      const path = url.origin === app.origin && url.pathname.startsWith(app.pathname) ? url.pathname.slice(app.pathname.length) : '';
      return SOURCES.has(path) ? path : 'unknown';
    } catch (_) { return 'unknown'; }
  }
  function cleanEvent(input) {
    if (!input || !KINDS.has(input.kind) || !AREAS.has(input.area)
      || typeof input.time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.time)) return null;
    const out = {time:input.time,kind:input.kind,area:input.area};
    if (['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(input.method)) out.method = input.method;
    if (OPERATIONS.has(input.operation) || input.operation === 'unknown' || input.operation === 'external') out.operation = input.operation;
    if (SOURCES.has(input.source)) out.source = input.source;
    if (input.errorType) out.errorType = safeErrorType(input.errorType);
    for (const [key,max] of [['status',599],['durationMs',3600000],['line',10000000],['column',1000000]]) {
      if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= max) out[key] = input[key];
    }
    return out;
  }
  function cleanEvents(value) {
    return Array.isArray(value) ? value.slice(-LIMIT).map(cleanEvent).filter(Boolean) : [];
  }
  function runtime(value) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    if (['dev','staging','production'].includes(value.environment)) out.environment = value.environment;
    if (typeof value.version === 'string' && /^[A-Za-z0-9._+-]{1,60}$/.test(value.version)) out.version = value.version;
    if (typeof value.commit === 'string' && /^[a-f0-9]{7,40}$/.test(value.commit)) out.commit = value.commit;
    if (typeof value.buildId === 'string' && /^[0-9-]{1,60}$/.test(value.buildId)) out.buildId = value.buildId;
    if (typeof value.deployedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value.deployedAt)) out.deployedAt = value.deployedAt;
    return out;
  }
  function browser(agent) {
    const match = String(agent).match(/(Edg|Firefox|Chrome|Version)\/(\d{1,3})\b/);
    // Edge also contains Chrome, so check it first.
    const edge = String(agent).match(/Edg\/(\d{1,3})\b/);
    return edge ? 'Edge '+edge[1] : match ? ({Firefox:'Firefox',Chrome:'Chrome',Version:'Safari'}[match[1]] || 'Browser')+' '+match[2] : 'Unbekannt';
  }
  const README = `Lehrfahrer – Support-Diagnose\n\nDie Datei diagnose.json entspricht der Vorschau vor dem Download.\nBitte in Ihrer E-Mail ergänzen: Was wollten Sie tun? Was geschah stattdessen? Wann trat das Problem auf?\n\nEnthalten: Versionsstand (falls erreichbar), Browserfamilie/-hauptversion, Online-Status und maximal 200 technische Hinweise dieses Tabs. Zeitangaben sind UTC. Auch erfolgreiche Serveraufrufe können zum zeitlichen Ablauf gehören.\nhttp: HTTP-Status; network_error: Anfrage ohne Antwort; application_rejected: Anwendung meldete ok=false; json_error: Antwort nicht als JSON lesbar; script_error/unhandled_rejection: Browserfehler; console_error/console_warning: Anwendung gab einen Fehler-/Warnhinweis aus (dessen Freitext wird nicht gesammelt); resource_error: Ressource konnte nicht geladen werden.\n\nGrenzen: Kein vollständiges Serverprotokoll, kein rückwirkender Fehlernachweis, keine GPS-/Navigationsaufzeichnung und kein Integritätsnachweis der Audit-Kette. Nur dieser Tab ab Beginn der Aufzeichnung; Browser können Hinweise blockieren. Keine Fehler im Verlauf bedeuten nicht, dass die Anwendung fehlerfrei war.\n\nKeine Passwörter, Cookies, Token, Anfrageparameter/-inhalte, Antwortinhalte, freien Fehlermeldungen, Namen, Bemerkungen, Routen oder Koordinaten. Der Verlauf wird nur lokal im Tab gespeichert, ist löschbar und wird nicht automatisch versendet. ZIP selbst an den vorgesehenen Support senden.\n`;
  function zip(json) {
    const encoder = new TextEncoder();
    const files = [['HINWEISE.txt',README],['diagnose.json',json]];
    const parts=[], central=[]; let offset=0,centralSize=0;
    function crc32(bytes) {
      let crc=0xffffffff;
      for (const byte of bytes) { crc ^= byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
      return (crc^0xffffffff)>>>0;
    }
    for (const [name,text] of files) {
      const filename=encoder.encode(name), bytes=encoder.encode(text), crc=crc32(bytes);
      const local=new Uint8Array(30+filename.length), l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);
      l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);
      const directory=new Uint8Array(46+filename.length),d=new DataView(directory.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);
      d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);directory.set(filename,46);
      parts.push(local,bytes);central.push(directory);offset+=local.length+bytes.length;centralSize+=directory.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    const output=new Uint8Array(offset+centralSize+end.length);let pos=0;
    for(const part of [...parts,...central,end]){output.set(part,pos);pos+=part.length;}
    return output;
  }
  return Object.freeze({LIMIT,operation,source,cleanEvent,cleanEvents,runtime,browser,safeErrorType,zip});
});
