const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(binary => spawnSync(binary, ['-v'], { encoding: 'utf8' }).status === 0);

test('Statusfolge und gespeicherte Route werden serverseitig durchgesetzt',
  { skip: !php && 'PHP nicht verfügbar' }, () => {
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-work-status-'));
    try {
      const code = `
        require ${JSON.stringify(path.join(root, 'api/_tenant_route_storage.php').replaceAll('\\', '/'))};
        require ${JSON.stringify(path.join(root, 'api/_gtfs_work_inventory.php').replaceAll('\\', '/'))};
        require ${JSON.stringify(path.join(root, 'api/_route_content_comparison.php').replaceAll('\\', '/'))};
        $company='cmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        $routeId='route-10'; $variantId='variant-a';
        $inventoryPath=lehrfahrer_gtfs_work_inventory_path($company);
        if (!is_dir(dirname($inventoryPath))) mkdir(dirname($inventoryPath),0700,true);
        $entry=['routeId'=>$routeId,'variantId'=>$variantId,'status'=>'UNGEPRUEFT',
            'reviewRequired'=>true,'timetableStatus'=>'UNVERAENDERT'];
        lehrfahrer_gtfs_work_write_json($inventoryPath,['entries'=>[$entry]]);
        $reference='cottbus/Linie_10/Standard/Route_01.json';
        $file=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_10','Standard',true);
        $other=lehrfahrer_route_file($company,'cottbus','Route_02','json','Linie_10','Standard',true);
        $route=['stops'=>[['name'=>'A'],['name'=>'B']], 'routePoints'=>[[51,14],[52,15]],
            'meta'=>['gtfsWork'=>['routeId'=>$routeId,'variantId'=>$variantId]]];
        file_put_contents($other,json_encode($route));
        $current=static fn() => lehrfahrer_gtfs_work_read_json($inventoryPath)['entries'][0];
        $reject=static function($target,$expected) use($company,$routeId,$variantId,$current,$inventoryPath) {
            $before=$current();
            $beforeBytes=file_get_contents($inventoryPath);
            try { lehrfahrer_gtfs_work_set_status($company,$routeId,$variantId,$target);
                throw new Exception('Unerlaubter Uebergang akzeptiert: '.$target); }
            catch(RuntimeException $error) {
                if ($error->getMessage()==='Unerlaubter Uebergang akzeptiert: '.$target) throw $error;
            }
            if ($current()['status']!==$expected || $current()['reviewRequired']!==$before['reviewRequired']
                || file_get_contents($inventoryPath)!==$beforeBytes)
                throw new Exception('Status nach Ablehnung veraendert');
        };
        $advance=static function($target,$expected) use($company,$routeId,$variantId,$current) {
            lehrfahrer_gtfs_work_set_status($company,$routeId,$variantId,$target);
            if ($current()['status']!==$expected) throw new Exception('Statusfolge unterbrochen');
        };
        $reject('GEPRUEFT','UNGEPRUEFT');
        $reject('FREIGEGEBEN','UNGEPRUEFT');
        $advance('IN_BEARBEITUNG','IN_BEARBEITUNG');
        $reject('FREIGEGEBEN','IN_BEARBEITUNG');
        $reject('GEPRUEFT','IN_BEARBEITUNG'); // Keine savedRoute, andere Datei mit passenden IDs vorhanden.
        $inventory=lehrfahrer_gtfs_work_read_json($inventoryPath);
        $inventory['entries'][0]['savedRoute']=$reference;
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventory);
        $reject('GEPRUEFT','IN_BEARBEITUNG'); // Referenzierte Datei fehlt; andere Datei darf nicht helfen.
        $route['meta']['gtfsWork']['variantId']='wrong';
        file_put_contents($file,json_encode($route));
        $reject('GEPRUEFT','IN_BEARBEITUNG');
        $route['meta']['gtfsWork']['variantId']=$variantId;
        $route['meta']['gtfsWork']['routeId']='wrong';
        file_put_contents($file,json_encode($route));
        $reject('GEPRUEFT','IN_BEARBEITUNG');
        $route['meta']['gtfsWork']['routeId']=$routeId;
        $route['route']=['original'=>[[51,14],[52,15]]];
        unset($route['routePoints']);
        file_put_contents($file,json_encode($route));
        $reject('GEPRUEFT','IN_BEARBEITUNG'); // route.original ist kein Ersatz fuer routePoints.
        $route['routePoints']=[[51,14]];
        file_put_contents($file,json_encode($route));
        $reject('GEPRUEFT','IN_BEARBEITUNG');
        $route['routePoints'][]=['lat'=>'ungueltig','lon'=>15];
        file_put_contents($file,json_encode($route));
        $reject('GEPRUEFT','IN_BEARBEITUNG');
        array_pop($route['routePoints']);
        $route['routePoints'][]=[52,15];
        file_put_contents($file,json_encode($route));
        $inventory=lehrfahrer_gtfs_work_read_json($inventoryPath);
        $inventory['entries'][]=$inventory['entries'][0];
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventory);
        try { lehrfahrer_gtfs_work_unique_entry($inventory,$routeId,$variantId); throw new Exception('Doppelter workOpen-Eintrag akzeptiert'); }
        catch(RuntimeException $error) {}
        $reject('GEPRUEFT','IN_BEARBEITUNG');
        array_pop($inventory['entries']);
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventory);
        $inventory['entries'][0]['timetableStatus']='ENTFALLEN';
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventory);
        $reject('GEPRUEFT','IN_BEARBEITUNG');
        $inventory['entries'][0]['timetableStatus']='UNVERAENDERT';
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventory);
        $advance('GEPRUEFT','GEPRUEFT');
        $beforeIdempotent=file_get_contents($inventoryPath);
        $advance('GEPRUEFT','GEPRUEFT');
        if (file_get_contents($inventoryPath)!==$beforeIdempotent) throw new Exception('Idempotenter Status hat Inventory geschrieben');
        $opened=lehrfahrer_gtfs_work_load_saved_route($company,$reference,$routeId,$variantId);
        if (($opened['source']['fileBase'] ?? null)!=='Route_01') throw new Exception('workOpen-Validierung abweichend');
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Zu frueh freigegeben');
        $reject('IN_BEARBEITUNG','GEPRUEFT');
        unlink($file);
        $reject('FREIGEGEBEN','GEPRUEFT');
        file_put_contents($file,json_encode($route));
        $advance('FREIGEGEBEN','FREIGEGEBEN');
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)===null) throw new Exception('Freigabe fehlt');
        $reject('GEPRUEFT','FREIGEGEBEN');
        $advance('FREIGEGEBEN','FREIGEGEBEN');
        if ($current()['reviewRequired']!==false) throw new Exception('Freigabe falsch markiert');
        if (lehrfahrer_gtfs_work_load_driver_route($company,$other)!==null) throw new Exception('Andere Datei wurde freigegeben');
        $snapshot=lehrfahrer_gtfs_work_read_json($inventoryPath);
        $duplicate=$snapshot; $duplicate['entries'][]=$duplicate['entries'][0];
        lehrfahrer_gtfs_work_write_json($inventoryPath,$duplicate);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Duplikat wurde freigegeben');
        lehrfahrer_gtfs_work_write_json($inventoryPath,$snapshot);
        $wrong=$snapshot; $wrong['entries'][0]['savedRoute']='cottbus/Linie_10/Standard/Route_02.json';
        lehrfahrer_gtfs_work_write_json($inventoryPath,$wrong);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Falsche savedRoute wurde freigegeben');
        $wrong['entries'][0]['savedRoute']='../cottbus/Linie_10/Standard/Route_01.json';
        lehrfahrer_gtfs_work_write_json($inventoryPath,$wrong);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Ungueltiger savedRoute-Pfad wurde freigegeben');
        lehrfahrer_gtfs_work_write_json($inventoryPath,$snapshot);
        $wrongRoute=$route; $wrongRoute['meta']['gtfsWork']['variantId']='wrong';
        file_put_contents($file,json_encode($wrongRoute));
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Falsche GTFS-Metadaten wurden freigegeben');
        file_put_contents($file,json_encode($route));
        unlink($file);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Fehlende Datei wurde freigegeben');
        file_put_contents($file,json_encode($route));
        $foreign='cmp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        if (lehrfahrer_gtfs_work_load_driver_route($foreign,$file)!==null) throw new Exception('Fremder Tenant wurde freigegeben');
        lehrfahrer_gtfs_work_revoke_release($company,$routeId,$variantId);
        if ($current()['status']!=='IN_BEARBEITUNG' || lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null)
            throw new Exception('Freigabe-Ruecknahme fehlgeschlagen');
        $advance('GEPRUEFT','GEPRUEFT');
        $advance('FREIGEGEBEN','FREIGEGEBEN');
        $same=$route; $same['savedAt']='2026-10-30T12:00:00+00:00';
        if (lehrfahrer_gtfs_work_save_route($company,$same,$reference,$file,json_encode($same))!=='UNCHANGED'
            || $current()['status']!=='FREIGEGEBEN') throw new Exception('UNCHANGED hat Freigabe veraendert');
        $changed=$route; $changed['routePoints'][1]=[53,16];
        $inventoryBefore=lehrfahrer_gtfs_work_read_json($inventoryPath);
        $wrongReference=$inventoryBefore;
        $wrongReference['entries'][0]['savedRoute']='cottbus/Linie_10/Standard/Route_02.json';
        lehrfahrer_gtfs_work_write_json($inventoryPath,$wrongReference);
        try { lehrfahrer_gtfs_work_save_route($company,$changed,$reference,$file,json_encode($changed));
            throw new Exception('Save mit fremder savedRoute akzeptiert'); }
        catch (RuntimeException $error) { if ($error->getMessage()==='Save mit fremder savedRoute akzeptiert') throw $error; }
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventoryBefore);
        $duplicate=$inventoryBefore; $duplicate['entries'][]=$duplicate['entries'][0];
        lehrfahrer_gtfs_work_write_json($inventoryPath,$duplicate);
        try { lehrfahrer_gtfs_work_save_route($company,$changed,$reference,$file,json_encode($changed));
            throw new Exception('Save mit Duplikat akzeptiert'); }
        catch (RuntimeException $error) { if ($error->getMessage()==='Save mit Duplikat akzeptiert') throw $error; }
        if (file_get_contents($file)!==json_encode($same)) throw new Exception('Fehlgeschlagener Save hat Route geaendert');
        lehrfahrer_gtfs_work_write_json($inventoryPath,$inventoryBefore);
        if (lehrfahrer_gtfs_work_save_route($company,$changed,$reference,$file,json_encode($changed))!=='CHANGED'
            || $current()['status']!=='IN_BEARBEITUNG'
            || lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null)
            throw new Exception('CHANGED hat Freigabe nicht sicher zurueckgestuft');
        $advance('GEPRUEFT','GEPRUEFT');
        $advance('FREIGEGEBEN','FREIGEGEBEN');
        echo 'OK';`;
      const result = spawnSync(php, ['-r', code], { cwd: root, encoding: 'utf8',
        env: { ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'OK');
    } finally { fs.rmSync(privateRoot, { recursive: true, force: true }); }
  });

test('Fahrer-Ladepfad behält die bestehende FREIGEGEBEN-Sperre', () => {
  const loader = fs.readFileSync(path.join(root, 'api/load_line.php'), 'utf8');
  const download = fs.readFileSync(path.join(root, 'api/_tenant_route_download.php'), 'utf8');
  assert.match(loader, /\$driverOnly = .*scope.*driver/);
  assert.match(loader, /lehrfahrer_gtfs_work_load_driver_route\(\$companyId, \$filePath\)/);
  assert.match(download, /!lehrfahrer_auth_has_capability\(\$auth, 'routes.write'\)/);
  assert.match(download, /lehrfahrer_gtfs_work_load_driver_route\(\$companyId, \$path\)/);
  assert.match(download, /echo json_encode\(\$route/);
});

test('workStatus meldet unzulässige Übergänge verständlich mit HTTP 409', () => {
  const endpoint = fs.readFileSync(path.join(root, 'api/import_gtfs.php'), 'utf8');
  const section = endpoint.slice(endpoint.indexOf('function gtfs_work_status(): void {'),
    endpoint.indexOf('function gtfs_work_archive(): void {'));
  assert.match(section, /gtfs_error\(409, \$error->getMessage\(\)\)/);
  assert.match(section, /Dieser GTFS-Arbeitsstatus kann nicht direkt gesetzt werden/);
  assert.match(section, /Vor Pruefung oder Freigabe muss eine gueltige Lehrfahrer-Route gespeichert sein/);
});

test('Freigabe-Rücknahme erfordert Session, Importrecht, CSRF und Cottbus-Scope', () => {
  const endpoint = fs.readFileSync(path.join(root, 'api/import_gtfs.php'), 'utf8');
  const section = endpoint.slice(endpoint.indexOf('function gtfs_work_revoke(): void {'),
    endpoint.indexOf('function gtfs_work_archive(): void {'));
  assert.match(section, /gtfs_require_cottbus_change_scope\(\)/);
  assert.match(section, /lehrfahrer_api_require_session\(\)/);
  assert.match(section, /lehrfahrer_auth_require_capability\(\$auth, 'routes.import'\)/);
  assert.match(section, /lehrfahrer_auth_require_csrf\(\$auth\['session'\]\)/);
  assert.match(endpoint, /if \(\$action === 'workrevoke'\) gtfs_work_revoke\(\)/);
});
