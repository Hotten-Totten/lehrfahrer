const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const core=require('../js/support-diagnostics-core.js');
const base='https://staging.lehrfahrer.de/';
const time='2026-11-08T17:00:00.000Z';

test('Support: nur bekannte Endpunkte und Quellen, keine privaten URL-Anteile',()=>{
 assert.equal(core.operation(base+'api/save_line.php?password=secret&route=Privat#token',base),'api/save_line.php');
 assert.equal(core.operation('https://user:secret@example.org/private-route',base),'external');
 assert.equal(core.operation(base+'data/trainings/private-name.json',base),'unknown');
 assert.equal(core.source(base+'js/editor.ui.js?token=secret',base),'js/editor.ui.js');
 assert.equal(core.source(base+'private-user.js',base),'unknown');
 const safe=core.cleanEvents([{time,kind:'script_error',area:'editor',source:'js/editor.ui.js',errorType:'Private Person secret',line:55,
   message:'password',stack:'private stack',cookie:'secret',name:'private name',route:'route data',status:9000}]);
 assert.deepEqual(safe,[{time,kind:'script_error',area:'editor',source:'js/editor.ui.js',errorType:'UnknownError',line:55}]);
 assert.deepEqual(core.cleanEvents([{time,kind:'private text',area:'editor'},null]),[]);
 assert.equal(core.cleanEvents(Array.from({length:300},()=>({time,kind:'http',area:'editor'}))).length,200);
});

test('Support: nur freigegebene Laufzeitdaten und grobe Browser-Version',()=>{
 assert.deepEqual(core.runtime({environment:'staging',version:'V2.1.070',commit:'a'.repeat(40),buildId:'42-1',deployedAt:'2026-11-08T16:00:00Z',password:'secret',companyId:'private',name:'Private',token:'token'}),{
   environment:'staging',version:'V2.1.070',commit:'a'.repeat(40),buildId:'42-1',deployedAt:'2026-11-08T16:00:00Z'});
 assert.deepEqual(core.runtime({version:'Name secret@example.org',commit:'password',buildId:'token',environment:'private'}),{});
 assert.equal(core.browser('Mozilla Chrome/132.0.1 Edg/132.0.5 private-name'),'Edge 132');
});

function collector({storageBroken=false,initial=null}={}) {
 const listeners={},cache=new Map(),calls=[];
 let response,problem;
 const document={currentScript:{src:base+'js/support-diagnostics.js?v=1'},readyState:'loading',addEventListener(){}};
 const window={LehrfahrerSupportCore:core,addEventListener(type,fn){listeners[type]=fn;},fetch:async function(...args){calls.push(args);if(problem)throw problem;return response;}};
 const sessionStorage={getItem:key=>cache.get(key) || initial,setItem(key,value){if(storageBroken)throw Error('blocked');cache.set(key,value);}};
 const context={window,document,location:{pathname:'/'},URL,Date,Reflect,performance:{now:()=>123},sessionStorage,console:{error(){},warn(){}},navigator:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/support-diagnostics.js'),'utf8'),context);
 return {window,listeners,cache,calls,setResponse(value){response=value},setProblem(value){problem=value},text:()=>[...cache.values()].join('')};
}

test('Support: Fetch und JSON unveraendert, HTTP/Anwendungsfehler ohne Dateninhalte',async()=>{
 const c=collector(),payload={ok:false,error:'Private Person password=secret',route:{coordinates:[1,2]},token:'private-token'};
 const response={status:403,json:async()=>payload};c.setResponse(response);
 const args=['api/save_line.php?token=private-token&name=Private Person',{method:'POST',headers:{'X-CSRF-Token':'secret'},body:'private payload'}];
 const actual=await c.window.fetch(...args);assert.equal(actual,response);assert.equal(c.calls[0][0],args[0]);assert.equal(c.calls[0][1],args[1]);
 assert.equal(await actual.json(),payload);
 assert.match(c.text(),/application_rejected/);assert.match(c.text(),/api\/save_line.php/);
 assert.doesNotMatch(c.text(),/Private Person|private-token|secret|payload|coordinates/);
 const error=new TypeError('private password');c.setProblem(error);
 await assert.rejects(c.window.fetch('api/save_line.php'),value=>value===error);
 assert.match(c.text(),/network_error/);assert.doesNotMatch(c.text(),/password/);
});

test('Support: Browserfehler und manipulierter Speicher geben keinen Freitext aus',()=>{
 const c=collector();
 c.listeners.error({target:c.window,filename:base+'js/editor.ui.js?token=secret',lineno:12,colno:4,error:new TypeError('private name'),message:'password'});
 c.listeners.unhandledrejection({reason:{name:'Private Person',stack:'private name\n at fn (https://staging.lehrfahrer.de/js/editor.api.js?token=secret:15:7)'}});
 assert.match(c.text(),/script_error/);assert.match(c.text(),/js\/editor.api.js/);
 assert.doesNotMatch(c.text(),/private name|Private Person|password|secret|fn/);
});

test('Support: gesperrter Browserspeicher beeintraechtigt Serveraufruf nicht',async()=>{
 const c=collector({storageBroken:true}),payload={ok:true};c.setResponse({status:200,json:async()=>payload});
 assert.equal(await (await c.window.fetch('api/list_lines.php')).json(),payload);
});

test('Support: ZIP laesst sich mit Standardbibliothek oeffnen, Vorschau exakt erhalten',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lf-support-'));
 try{
   const json=JSON.stringify({format:'test',text:'Umlaute äöü',events:[]},null,2)+'\n';
   const file=path.join(folder,'support.zip');fs.writeFileSync(file,core.zip(json));fs.writeFileSync(path.join(folder,'expected.json'),json);
   const result=spawnSync('python',['-c',`import zipfile,pathlib,sys; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/'support.zip'); assert z.namelist()==['HINWEISE.txt','diagnose.json']; assert z.testzip() is None; assert z.read('diagnose.json')==(p/'expected.json').read_bytes(); assert 'kein' in z.read('HINWEISE.txt').decode('utf-8').lower()`,folder],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('Support: wiederhergestellter Tab-Verlauf wird erneut strikt bereinigt',()=>{
 const c=collector({initial:JSON.stringify([{time,kind:'http',area:'editor',operation:'api/save_line.php',message:'private secret',token:'secret',source:'private-name.js'},{time,kind:'private name',area:'editor'}])});
 assert.match(c.text(),/api\/save_line.php/);assert.doesNotMatch(c.text(),/private|secret|token|message/);
});
