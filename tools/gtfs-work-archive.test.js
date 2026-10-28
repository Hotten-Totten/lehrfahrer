const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const phpSource = fs.readFileSync(path.join(root, 'api/_gtfs_work_inventory.php'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'api/import_gtfs.php'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'api/_api_authorization.php'), 'utf8');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean).find(binary => {
  const result = spawnSync(binary, ['-v'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
});

test('Archivaktion bleibt an routes.import, Cottbus-Mandant und CSRF gebunden', () => {
  assert.match(endpoint, /lehrfahrer_route_authorize\('routes\.import', true, true\)/);
  assert.match(endpoint, /function gtfs_work_archive\(\): void\s*\{\s*gtfs_require_cottbus_change_scope\(\)/);
  assert.match(endpoint, /\$auth = lehrfahrer_api_require_session\(\);\s*lehrfahrer_auth_require_capability\(\$auth, 'routes\.import'\);\s*lehrfahrer_auth_require_same_origin\(\);\s*lehrfahrer_auth_require_csrf\(\$auth\['session'\]\)/);
  assert.match(endpoint, /if \(\$action === 'workarchive'\) gtfs_work_archive\(\)/);
  assert.match(auth, /if \(\$mutation\) \{\s*lehrfahrer_auth_require_same_origin\(\);\s*lehrfahrer_auth_require_csrf/);
  assert.match(phpSource, /lehrfahrer_gtfs_work_with_inventory_lock\(\$companyId/);
});

test('Archivfeld bleibt bei identischem CURRENT erhalten und keine anderen Felder gehen verloren',
  { skip: !php && 'PHP lokal nicht verfügbar' }, () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-work-archive-'));
    try {
      const phpFile = JSON.stringify(path.join(root, 'api/_gtfs_work_inventory.php').replaceAll('\\', '/'));
      const base = JSON.stringify(sandbox.replaceAll('\\', '/'));
      const code = `
        $base = ${base};
        function lehrfahrer_tenant_path($company, $area, $relative) {
            global $base;
            return $base . '/companies/' . $company . '/' . $area . '/' . $relative;
        }
        function lehrfahrer_tenant_ensure_directory($company, $area, $relative) {
            $path = lehrfahrer_tenant_path($company, $area, $relative);
            if (!is_dir($path)) mkdir($path, 0700, true);
            return $path;
        }
        function lehrfahrer_gtfs_operator_id_from_index($path) { return '287'; }
        function lehrfahrer_gtfs_change_read_index($path, $ids) { return $GLOBALS['index']; }
        require ${phpFile};
        $company = 'cmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        $variant = static fn($id) => ['variantId'=>$id, 'directionId'=>'0', 'headsign'=>'Ziel',
            'startStop'=>'Start', 'destination'=>'Ziel', 'stopNames'=>['Start','Ziel'],
            'stopCount'=>2, 'signature'=>'sig-' . $id];
        $route = static fn($variants) => ['routeId'=>'route-16', 'shortName'=>'16', 'variants'=>$variants];
        $GLOBALS['index'] = ['sha256'=>'index-a', 'routes'=>['route-16'=>$route([$variant('a'),$variant('b')])]];
        $initial = lehrfahrer_gtfs_work_reconcile($company, 'current.sqlite', ['287']);
        lehrfahrer_gtfs_work_update_entry($company, 'route-16', 'b', static function ($entry) {
            $entry['status'] = 'GEPRUEFT'; $entry['savedRoute'] = 'Route 03';
            $entry['draftPrepared'] = true; return $entry;
        });
        $archived = lehrfahrer_gtfs_work_set_archived($company, 'current.sqlite', 'route-16', 'a', true);
        if ($archived['entries'][1]['status'] !== 'GEPRUEFT' || $archived['entries'][1]['savedRoute'] !== 'Route 03'
            || $archived['entries'][1]['draftPrepared'] !== true) throw new Exception('Anderer Eintrag ueberschrieben');
        $before = $initial['entries'][0]; $after = $archived['entries'][0];
        unset($before['archived'], $after['archived']);
        if ($before !== $after) throw new Exception('Archivierung hat Fachdaten veraendert');
        lehrfahrer_gtfs_work_set_status($company, 'route-16', 'a', 'IN_BEARBEITUNG');
        $restored = lehrfahrer_gtfs_work_set_archived($company, 'current.sqlite', 'route-16', 'a', false);
        if ($restored['entries'][0]['status'] !== 'IN_BEARBEITUNG') throw new Exception('Status verloren');
        try { lehrfahrer_gtfs_work_set_archived($company,'current.sqlite','route-16','a',true); throw new Exception('Bestaetigung umgangen'); }
        catch (RuntimeException $error) { if ($error->getMessage() === 'Bestaetigung umgangen') throw $error; }
        $archived = lehrfahrer_gtfs_work_set_archived($company, 'current.sqlite', 'route-16', 'a', true, true);
        $failures = 0;
        foreach ([['wrong-route','a'], ['route-16','missing']] as [$routeId,$variantId]) {
            try { lehrfahrer_gtfs_work_set_archived($company,'current.sqlite',$routeId,$variantId,true); }
            catch (Throwable $error) { $failures++; }
        }
        if ($failures !== 2) throw new Exception('Unbekannte Identitaet akzeptiert');
        $GLOBALS['index']['sha256'] = 'index-b';
        try { lehrfahrer_gtfs_work_set_archived($company,'current.sqlite','route-16','a',false); throw new Exception('SHA mismatch akzeptiert'); }
        catch (RuntimeException $error) { if ($error->getMessage() === 'SHA mismatch akzeptiert') throw $error; }
        $GLOBALS['index']['routes']['route-16'] = $route([$variant('a'),$variant('c')]);
        $next = lehrfahrer_gtfs_work_reconcile($company, 'current.sqlite', ['287']);
        $byId = [];
        foreach ($next['entries'] as $entry) $byId[$entry['variantId']] = $entry;
        if ($byId['a']['archived'] !== true || $byId['c']['archived'] !== false
            || $byId['b']['timetableStatus'] !== 'ENTFALLEN') throw new Exception('Abgleich inkonsistent');
        try { lehrfahrer_gtfs_work_set_archived($company,'current.sqlite','route-16','b',false); throw new Exception('ENTFALLEN akzeptiert'); }
        catch (RuntimeException $error) { if ($error->getMessage() === 'ENTFALLEN akzeptiert') throw $error; }
        if ($next['completeness']['capturedVariantCount'] !== 2) throw new Exception('CURRENT unvollstaendig');
        $GLOBALS['index']['sha256'] = 'index-c';
        $GLOBALS['index']['routes'] = ['new-route'=>['routeId'=>'new-route','shortName'=>'16','variants'=>[$variant('a')]]];
        $changedRoute = lehrfahrer_gtfs_work_reconcile($company, 'current.sqlite', ['287']);
        $newEntry = array_values(array_filter($changedRoute['entries'], static fn($entry) => $entry['routeId'] === 'new-route'))[0];
        if ($newEntry['archived'] !== false) throw new Exception('Archivstatus auf andere routeId uebertragen');
        echo json_encode(['archive'=>$byId['a']['archived'], 'new'=>$byId['c']['archived'],
            'historical'=>$byId['b']['timetableStatus'], 'status'=>$byId['a']['status']]);
      `;
      const result = spawnSync(php, ['-r', code], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { archive: true, new: false,
        historical: 'ENTFALLEN', status: 'IN_BEARBEITUNG' });
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
