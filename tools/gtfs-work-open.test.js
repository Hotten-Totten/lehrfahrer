const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'api/import_gtfs.php'), 'utf8');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(binary => spawnSync(binary, ['-v'], { encoding: 'utf8' }).status === 0);
const company = 'cmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const otherCompany = 'cmp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const reference = 'cottbus/Linie_10/Standard/Route_02.json';

test('savedRoute verweist nur auf die exakte Tenant-Datei mit passenden GTFS-Kennungen',
  { skip: !php && 'PHP nicht verfügbar' }, () => {
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-work-open-'));
    try {
      const routeDir = path.join(privateRoot, 'companies', company, 'lines', 'cottbus', 'Linie_10', 'Standard');
      const otherDir = path.join(privateRoot, 'companies', otherCompany, 'lines', 'cottbus', 'Linie_10', 'Standard');
      fs.mkdirSync(routeDir, { recursive: true });
      fs.mkdirSync(otherDir, { recursive: true });
      const good = { lineName: 'Linie 10', stops: [{ name: 'A' }, { name: 'B' }],
        routePoints: [[51, 14], [52, 15]], meta: { gtfsWork: { routeId: 'r10', variantId: 'v2' } } };
      const file = path.join(routeDir, 'Route_02.json');
      fs.writeFileSync(file, JSON.stringify(good));
      fs.writeFileSync(path.join(otherDir, 'Route_02.json'), JSON.stringify(good));
      fs.writeFileSync(path.join(routeDir, 'Route_02_01.json'), JSON.stringify(good));
      const code = `require ${JSON.stringify(path.join(root, 'api/_tenant_route_storage.php').replaceAll('\\', '/'))};
        require ${JSON.stringify(path.join(root, 'api/_gtfs_work_inventory.php').replaceAll('\\', '/'))};
        $result = lehrfahrer_gtfs_work_load_saved_route(${JSON.stringify(company)}, $argv[1], $argv[2], $argv[3]);
        echo json_encode($result);`;
      const run = (ref, routeId = 'r10', variantId = 'v2') => spawnSync(php,
        ['-r', code, ref, routeId, variantId],
        { cwd: root, encoding: 'utf8', env: { ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot } });
      const valid = run(reference);
      assert.equal(valid.status, 0, valid.stderr);
      const payload = JSON.parse(valid.stdout);
      assert.equal(payload.line.meta.gtfsWork.variantId, 'v2');
      assert.deepEqual(payload.source, { city: 'cottbus', lineFolder: 'Linie_10',
        categoryFolder: 'Standard', fileBase: 'Route_02' });
      for (const [ref, routeId, variantId] of [
        [reference, 'wrong', 'v2'], [reference, 'r10', 'wrong'],
        ['cottbus/Linie_10/Standard/missing.json', 'r10', 'v2'],
        ['cottbus/Linie_10/Standard/Route_02_02.json', 'r10', 'v2'],
        ['../cottbus/Linie_10/Standard/Route_02.json', 'r10', 'v2'],
        [`../${otherCompany}/lines/${reference}`, 'r10', 'v2']
      ]) assert.notEqual(run(ref, routeId, variantId).status, 0, ref);
      fs.writeFileSync(file, '{');
      assert.notEqual(run(reference).status, 0, 'ungültiges JSON abgewiesen');
      fs.writeFileSync(file, JSON.stringify({ meta: good.meta }));
      assert.notEqual(run(reference).status, 0, 'kein Route-JSON abgewiesen');
      fs.writeFileSync(file, JSON.stringify({ ...good, routePoints: [[51, 14]] }));
      assert.notEqual(run(reference).status, 0, 'Route mit weniger als zwei Routenpunkten abgewiesen');
      fs.writeFileSync(file, JSON.stringify({ ...good, routePoints: [[51, 14]], route: { original: [[51, 14], [52, 15]] } }));
      assert.notEqual(run(reference).status, 0, 'route.original ersetzt keine routePoints');
    } finally { fs.rmSync(privateRoot, { recursive: true, force: true }); }
  });

test('workOpen trennt Entwurf und Serverroute und bewahrt Status beim bloßen Öffnen', () => {
  const workOpen = endpoint.slice(endpoint.indexOf('function gtfs_work_open(): void {'),
    endpoint.indexOf('function gtfs_work_status(): void {'));
  assert.match(workOpen, /lehrfahrer_gtfs_work_load_saved_route/);
  assert.match(workOpen, /lehrfahrer_gtfs_work_unique_entry/);
  assert.doesNotMatch(workOpen, /lehrfahrer_gtfs_work_reconcile/);
  assert.match(workOpen, /lehrfahrer_gtfs_work_read_json\(lehrfahrer_gtfs_work_inventory_path/);
  const inventoryEndpoint = endpoint.slice(endpoint.indexOf('function gtfs_work_inventory_response('),
    endpoint.indexOf('function gtfs_work_open(): void {'));
  assert.match(inventoryEndpoint, /lehrfahrer_gtfs_work_reconcile/);
  assert.match(workOpen, /if \(\$reference !== null && \$reference !== ''\)/);
  assert.match(workOpen, /gtfs_reply\(\['ok' => true, 'line' => \$saved\['line'\], 'source' => \$saved\['source'\]/);
  assert.match(workOpen, /lehrfahrer_gtfs_work_prepare/);
  assert.doesNotMatch(workOpen, /lehrfahrer_gtfs_work_set_status/);
  assert.match(workOpen, /gtfs_error\(409, 'Die gespeicherte Lehrfahrer-Route/);
});

test('workOpen öffnet Entwurf nur ohne Referenz und bewahrt alle gespeicherten Statuswerte',
  { skip: !php && 'PHP nicht verfügbar' }, () => {
    const workOpen = endpoint.slice(endpoint.indexOf('function gtfs_work_open(): void {'),
      endpoint.indexOf('function gtfs_work_status(): void {'));
    const code = `
      define('LEHRFAHRER_GTFS_COMPANY_ID', ${JSON.stringify(company)});
      class WorkReply extends Exception { public array $payload; function __construct(array $payload) { $this->payload = $payload; } }
      function gtfs_require_cottbus_change_scope() {}
      function gtfs_index_path() { return 'index'; }
      function lehrfahrer_gtfs_work_inventory_path($company) { return $GLOBALS['inventoryPath']; }
      function lehrfahrer_gtfs_work_read_json($path) { return json_decode(file_get_contents($path),true); }
      function lehrfahrer_gtfs_work_reconcile($company,$path,$agencies) { throw new Exception('Unzulässiger Reconcile'); }
      function lehrfahrer_gtfs_work_unique_entry($inventory,$routeId,$variantId) {
        $matches=array_values(array_filter($inventory['entries'], static fn($entry) =>
          $entry['routeId']===$routeId && $entry['variantId']===$variantId));
        if (count($matches)!==1) throw new RuntimeException('Nicht eindeutig');
        return $matches[0];
      }
      function lehrfahrer_gtfs_work_load_saved_route($company, $reference, $routeId, $variantId) {
        $GLOBALS['loads'][] = 'saved';
        if ($reference === 'invalid') throw new RuntimeException('invalid');
        return ['line'=>['kind'=>'saved'], 'source'=>['city'=>'cottbus','lineFolder'=>'Linie_10',
          'categoryFolder'=>'Standard','fileBase'=>'Route_02']];
      }
      function lehrfahrer_gtfs_work_prepare($company, $path, $routeId, $variantId) {
        $GLOBALS['loads'][] = 'draft'; return ['kind'=>'draft'];
      }
      function lehrfahrer_gtfs_work_set_status($company, $routeId, $variantId, $status) {
        $GLOBALS['statusChanges'][] = $status; return ['entries'=>[]];
      }
      function gtfs_reply($payload, $status=200) { throw new WorkReply($payload + ['httpStatus'=>$status]); }
      function gtfs_error($status, $message) { gtfs_reply(['ok'=>false,'error'=>$message],$status); }
      ${workOpen}
      $_POST = ['routeId'=>'r10','variantId'=>'v2']; $results = [];
      $GLOBALS['inventoryPath']=tempnam(sys_get_temp_dir(),'lf-work-open-');
      foreach ([['UNGEPRUEFT',null],['IN_BEARBEITUNG','valid'],['GEPRUEFT','valid'],
        ['FREIGEGEBEN','valid'],['GEPRUEFT','invalid'],['GEPRUEFT','valid'],['GEPRUEFT','valid']] as $index=>[$status,$reference]) {
        $GLOBALS['status']=$status; $GLOBALS['reference']=$reference;
        $GLOBALS['duplicate']=$index===5;
        $entry=['routeId'=>'r10','variantId'=>'v2','status'=>$status,
          'timetableStatus'=>'UNVERAENDERT','savedRoute'=>$reference];
        $entries=$index===6 ? [] : ($GLOBALS['duplicate'] ? [$entry,$entry] : [$entry]);
        file_put_contents($GLOBALS['inventoryPath'],json_encode(['entries'=>$entries]));
        $before=file_get_contents($GLOBALS['inventoryPath']);
        $GLOBALS['loads']=[]; $GLOBALS['statusChanges']=[];
        try { gtfs_work_open(); } catch (WorkReply $reply) { $response=$reply->payload; }
        $results[]=['response'=>$response,'loads'=>$GLOBALS['loads'],'statusChanges'=>$GLOBALS['statusChanges'],
          'inventoryUnchanged'=>file_get_contents($GLOBALS['inventoryPath'])===$before];
      }
      unlink($GLOBALS['inventoryPath']);
      echo json_encode($results);`;
    const result = spawnSync(php, ['-r', code], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.deepEqual(rows[0].loads, ['draft']);
    assert.deepEqual(rows[0].statusChanges, []);
    assert.equal(rows[0].inventoryUnchanged, true);
    for (const row of rows.slice(1, 4)) {
      assert.deepEqual(row.loads, ['saved']);
      assert.deepEqual(row.statusChanges, []);
      assert.equal(row.inventoryUnchanged, true);
      assert.equal(row.response.line.kind, 'saved');
      assert.equal(row.response.source.fileBase, 'Route_02');
    }
    assert.equal(rows[4].response.httpStatus, 409);
    assert.deepEqual(rows[4].loads, ['saved']);
    assert.deepEqual(rows[4].statusChanges, []);
    assert.equal(rows[5].response.httpStatus, 409);
    assert.deepEqual(rows[5].loads, []);
    assert.deepEqual(rows[5].statusChanges, []);
    assert.equal(rows[5].inventoryUnchanged, true);
    assert.equal(rows[6].response.httpStatus, 409);
    assert.equal(rows[6].inventoryUnchanged, true);
  });

test('Frontend setzt Ladequelle nur nach gespeicherter Route und berechnet nur Entwurf neu', async () => {
  const begin = api.indexOf('function gtfsWorkStatusLabel(status) {');
  const end = api.indexOf('async function loadGtfsVersionInfo(', begin);
  const identity = api.slice(api.indexOf('function routeStorageIdentity('), api.indexOf('function isLoadedServerRouteTarget('));
  const nodes = {};
  const node = () => ({ children: [], textContent: '', disabled: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {},
    querySelectorAll() { return []; }, append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; }, replaceChildren(...children) { this.children = children; } });
  for (const id of ['gtfsWorkModal', 'gtfsWorkCompleteness', 'gtfsWorkList', 'gtfsWorkReport',
    'gtfsWorkCloseBtn', 'gtfsWorkPrepareAllBtn', 'gtfsWorkArchiveBtn']) nodes[id] = node();
  const state = { loadedServerRouteSource: null };
  let builds = 0;
  let response;
  const requests = [];
  const context = { state, document: { getElementById: id => nodes[id], createElement: node },
    gtfsChangeElement(_tag, _class, text) { const item = node(); item.textContent = text; return item; },
    postGtfsImport: async request => {
      requests.push(request);
      return request.action === 'workStatus' ? { inventory: { entries: [], completeness: {} } } : response;
    },
    loadLineFromData() { state.loadedServerRouteSource = null; },
    buildStreetRouteFromStops: async () => { builds++; } };
  vm.runInNewContext(identity + api.slice(begin, end) + '\nglobalThis.render = renderGtfsWorkInventory;', context);
  const entry = { routeId: 'r10', variantId: 'v2', line: '10', stopNames: ['A', 'B'], stopCount: 2,
    status: 'GEPRUEFT', timetableStatus: 'UNVERAENDERT', draftPrepared: true, savedRoute: reference };
  context.render({ entries: [entry], completeness: {} });
  const button = nodes.gtfsWorkList.children[0].children[5].children[0];
  assert.equal(button.textContent, 'Route öffnen');
  response = { line: { stops: [], routePoints: [] }, source: { city: 'cottbus', lineFolder: 'Linie_10',
    categoryFolder: 'Standard', fileBase: 'Route_02' } };
  await button.onclick();
  assert.deepEqual({ ...state.loadedServerRouteSource }, response.source);
  assert.equal(builds, 0);
  response = { line: { stops: [], routePoints: [] } };
  await button.onclick();
  assert.equal(state.loadedServerRouteSource, null);
  assert.equal(builds, 1);
  assert.equal(entry.status, 'GEPRUEFT');
  assert.equal(requests.filter(request => request.action === 'workStatus').length, 0);
  const draft = { ...entry, status: 'UNGEPRUEFT', draftPrepared: false, savedRoute: null };
  context.render({ entries: [draft], completeness: {} });
  const create = nodes.gtfsWorkList.children[0].children[5].children[0];
  response = { line: { stops: [], routePoints: [] }, inventory: { entries: [draft], completeness: {} } };
  await create.onclick();
  assert.equal(requests.at(-1).action, 'workStatus');
  assert.equal(requests.at(-1).status, 'IN_BEARBEITUNG');
  assert.equal(builds, 2);
});

test('aktualisierter API-Cache-Key entspricht der Datei', () => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'js/editor.api.js'), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex').slice(0, 12);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, new RegExp(`js/editor\\.api\\.js\\?v=${hash}`));
});
