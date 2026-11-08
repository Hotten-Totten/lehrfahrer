/* Support recording deliberately excludes free text, payloads, headers and URL parameters. */
(() => {
  'use strict';
  const core = window.LehrfahrerSupportCore;
  if (!core || window.LehrfahrerSupport) return;
  const base = new URL('../', document.currentScript.src).href;
  const path = location.pathname.slice(new URL(base).pathname.length);
  const area = path.startsWith('app/') ? 'driver_app' : path === 'account-login.php' ? 'account_login'
    : path === 'login.html' ? 'legacy_login' : path === 'audit.html' ? 'audit' : 'editor';
  const key = 'lehrfahrer-support-v1';
  let events = [];
  let dropped = 0;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored && stored.length < 150000) events = core.cleanEvents(JSON.parse(stored));
  } catch (_) { /* Diagnostics must never prevent normal application use. */ }
  function record(kind, fields = {}) {
    try {
      const item = core.cleanEvent({...fields,time:new Date().toISOString(),kind,area});
      if (!item) return;
      events.push(item);
      if (events.length > core.LIMIT) { events.shift(); dropped++; }
      try { sessionStorage.setItem(key,JSON.stringify(events)); } catch (_) { /* Memory-only fallback. */ }
    } catch (_) { /* Best-effort diagnostic collection. */ }
  }
  record('page_open');
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const started = performance.now();
      let operation = 'unknown', method = 'GET';
      try { method = String(args[1]?.method || args[0]?.method || 'GET').toUpperCase(); } catch (_) { /* Unknown method. */ }
      try { operation = core.operation(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0]?.url,base); } catch (_) { /* Unknown request. */ }
      try {
        const response = await Reflect.apply(originalFetch,this,args);
        if (operation.startsWith('api/') || !response.ok) record('http',{operation,method,status:response.status,durationMs:Math.min(3600000,Math.max(0,Math.round(performance.now()-started)))});
        // Inspect only the success flag when the application itself reads JSON; never clone or retain response bodies.
        if (operation.startsWith('api/')) {
          try {
            const originalJson = response.json;
            Object.defineProperty(response,'json',{configurable:true,writable:true,value:async function (...jsonArgs) {
              try {
                const data = await Reflect.apply(originalJson,this,jsonArgs);
                if (data && typeof data === 'object' && data.ok === false) record('application_rejected',{operation,method,status:response.status});
                return data;
              } catch (error) { record('json_error',{operation,method,errorType:core.safeErrorType(error?.name)});throw error; }
            }});
          } catch (_) { /* Some browsers may expose non-extensible responses. */ }
        }
        return response;
      } catch (error) {
        record('network_error',{operation,method,errorType:core.safeErrorType(error?.name)});
        throw error;
      }
    };
  }
  function callsite(error) {
    try {
      for (const frame of String(error?.stack || '').split('\n').slice(1,12)) {
        const match=frame.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
        if (!match) continue;
        const file=core.source(match[1],base);
        if (file !== 'unknown' && file !== 'js/support-diagnostics.js') return {source:file,line:Number(match[2]),column:Number(match[3])};
      }
    } catch (_) { /* No safe call site available. */ }
    return {};
  }
  window.addEventListener('error', event => {
    if (event.target !== window) {
      record('resource_error',{source:core.source(event.target?.src || event.target?.href || '',base)});
    } else {
      record('script_error',{source:core.source(event.filename,base),line:event.lineno,column:event.colno,errorType:core.safeErrorType(event.error?.name)});
    }
  },true);
  window.addEventListener('unhandledrejection', event => record('unhandled_rejection',{...callsite(event.reason),errorType:core.safeErrorType(event.reason?.name)}));
  window.addEventListener('online',()=>record('online'));
  window.addEventListener('offline',()=>record('offline'));
  for (const level of ['error','warn']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      record(level === 'error' ? 'console_error' : 'console_warning',callsite(new Error()));
      return Reflect.apply(original,this,args);
    };
  }
  let dialog, preview, status, save, frozenReport, runtime = {}, runtimeAvailable = false;
  function snapshot() {
    return {
      format:'lehrfahrer-support-v1', createdAt:new Date().toISOString(),
      runtime:core.runtime(runtime),runtimeAvailable,
      browser:core.browser(navigator.userAgent),online:navigator.onLine === true,
      serviceWorkerControlled:!!navigator.serviceWorker?.controller,
      area,limit:core.LIMIT,droppedSincePageOpen:dropped,
      events:core.cleanEvents(events),
      limitations:['Nur technischer Verlauf dieses Browser-Tabs ab Aufzeichnungsbeginn.',
        'Kein vollständiges Serverprotokoll; keine GPS-/Navigationsdaten oder Fachdaten.',
        'Fehlermeldungs-Freitext wird zum Schutz vertraulicher Angaben nicht gesammelt.']
    };
  }
  function refreshPreview() {
    frozenReport = JSON.stringify(snapshot(),null,2)+'\n';
    preview.textContent = frozenReport;
    status.textContent = `${events.length} technische Hinweise. ${runtimeAvailable ? 'Server-Version ermittelt.' : 'Server-Version nicht verfügbar; lokale Hinweise sind enthalten.'} Vorschau und ZIP enthalten denselben Stand.`;
  }
  function button(text, handler) {
    const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',handler);return b;
  }
  async function open() {
    if (!dialog) {
      dialog=document.createElement('dialog');dialog.id='lf-support-dialog';dialog.setAttribute('aria-labelledby','lf-support-title');
      const title=document.createElement('h2');title.id='lf-support-title';title.textContent='Diagnose für den Support';
      const intro=document.createElement('p');intro.textContent='Diese ZIP hilft dem Support, Fehlfunktionen einzugrenzen. Sie enthält Zeitpunkt, Version und technische Hinweise dieses Tabs – keine Passwörter, Namen, Bemerkungen oder Routen. Es wird nichts automatisch versendet.';
      const help=document.createElement('p');help.textContent='Am besten: Problem erneut ausführen, danach die Diagnose öffnen und herunterladen. In der E-Mail kurz beschreiben, was Sie tun wollten und was stattdessen passiert ist. Dies ist kein vollständiges Serverprotokoll.';
      status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Vollständigen Inhalt von diagnose.json ansehen';
      preview=document.createElement('pre');details.append(summary,preview);
      const actions=document.createElement('div');actions.className='lf-support-actions';
      save=button('ZIP herunterladen',()=>{
        try {
          const blob=new Blob([core.zip(frozenReport)],{type:'application/zip'}),url=URL.createObjectURL(blob);
          const a=document.createElement('a');a.href=url;a.download='Lehrfahrer-Diagnose-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';
          document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
          status.textContent='ZIP-Download gestartet. Sie können die Datei selbst per E-Mail an den Support anhängen.';
        } catch (_) { status.textContent='ZIP konnte nicht erstellt werden. Bitte den Inhalt der Vorschau kopieren.'; }
      });
      const clear=button('Lokalen Verlauf leeren',()=>{ events=[];dropped=0;try{sessionStorage.removeItem(key);}catch(_){} refreshPreview(); });
      const close=button('Schließen',()=>dialog.close());actions.append(save,clear,close);
      dialog.append(title,intro,help,status,details,actions);document.body.append(dialog);
    }
    if (dialog.open) return;
    dialog.showModal();save.disabled=true;status.textContent='Versionsstand wird geprüft …';
    refreshPreview();
    try {
      if (typeof originalFetch !== 'function') throw new Error();
      const response=await originalFetch.call(window,new URL('api/auth/runtime.php',base),{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
      const data=await response.json();runtime=core.runtime(data.runtime);runtimeAvailable=response.ok && data.ok === true && !!runtime.version;
    } catch (_) { runtimeAvailable=false;runtime={}; }
    finally { refreshPreview();save.disabled=false; }
  }
  window.LehrfahrerSupport=Object.freeze({open});
  function bind() {
    document.querySelectorAll('[data-support-diagnostics]').forEach(b=>b.addEventListener('click',()=>{open().catch(()=>{});}));
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
