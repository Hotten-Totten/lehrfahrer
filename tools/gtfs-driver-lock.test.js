const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const php = [process.env.PHP_BINARY, 'php', 'C:\\xampp\\php\\php.exe'].filter(Boolean)
  .find(binary => spawnSync(binary, ['-v'], { encoding: 'utf8' }).status === 0);
const storage = JSON.stringify(path.join(root, 'api/_tenant_route_storage.php').replaceAll('\\', '/'));
const work = JSON.stringify(path.join(root, 'api/_gtfs_work_inventory.php').replaceAll('\\', '/'));

test('GTFS-Tempdatei wird nur nach vollständigem Schreiben und Validieren aktiviert',
  { skip: !php && 'PHP nicht verfügbar' }, () => {
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-gtfs-temp-'));
    try {
      const code = `require ${storage}; require ${work};
        $company='cmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        $file=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_10','Standard',true);
        $old=['stops'=>[], 'routePoints'=>[], 'meta'=>['gtfsWork'=>['routeId'=>'r','variantId'=>'v']]];
        file_put_contents($file,json_encode($old));
        $valid=$old; $valid['routePoints']=[[51,14],[52,15]];
        $json=json_encode($valid);
        $reject=function($payload,$writer=null) use($file,$json) {
          try { lehrfahrer_gtfs_work_prepare_route_file($file,$payload,'r','v',$writer);
            throw new Exception('Ungueltige Tempdatei akzeptiert');
          } catch (RuntimeException $e) {
            if ($e->getMessage()==='Ungueltige Tempdatei akzeptiert') throw $e;
          }
          if (file_get_contents($file)!==json_encode(['stops'=>[], 'routePoints'=>[],
              'meta'=>['gtfsWork'=>['routeId'=>'r','variantId'=>'v']]])) throw new Exception('Bestandsdatei veraendert');
          if (glob($file.'.tmp-*')) throw new Exception('Tempdatei nicht entfernt');
        };
        $reject($json,static function($handle,$contents) {
          return fwrite($handle,substr($contents,0,intdiv(strlen($contents),2)));
        });
        $reject('{"stops":');
        $wrong=$valid; $wrong['meta']['gtfsWork']['routeId']='wrong'; $reject(json_encode($wrong));
        $wrong=$valid; $wrong['meta']['gtfsWork']['variantId']='wrong'; $reject(json_encode($wrong));
        $temp=lehrfahrer_gtfs_work_prepare_route_file($file,$json,'r','v');
        if (!is_file($temp) || file_get_contents($temp)!==$json) throw new Exception('Gueltige Tempdatei fehlt');
        unlink($temp); echo 'OK';`;
      const result = spawnSync(php, ['-r', code], { cwd: root, encoding: 'utf8',
        env: { ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'OK');
    } finally {
      fs.rmSync(privateRoot, { recursive: true, force: true });
    }
  });

test('Driver-Scope sperrt fehlendes, ungültiges und mehrdeutiges Inventory ohne Nicht-GTFS-Bestand zu verlieren',
  { skip: !php && 'PHP nicht verfügbar' }, () => {
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-gtfs-driver-'));
    try {
      const code = `require ${storage}; require ${work};
        $company='cmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        $file=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_10','Standard',true);
        $legacy=lehrfahrer_route_file($company,'cottbus','Legacy','json','Linie_9','Standard',true);
        $route=['stops'=>[], 'routePoints'=>[[51,14],[52,15]],
          'meta'=>['gtfsWork'=>['routeId'=>'r','variantId'=>'v']]];
        file_put_contents($file,json_encode($route)); file_put_contents($legacy,json_encode(['stops'=>[],'routePoints'=>[]]));
        $path=lehrfahrer_gtfs_work_inventory_path($company);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Ohne Inventory freigegeben');
        file_put_contents($path,'{broken');
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Kaputtes Inventory freigegeben');
        $entry=['routeId'=>'r','variantId'=>'v','status'=>'FREIGEGEBEN',
          'timetableStatus'=>'UNVERAENDERT','savedRoute'=>'cottbus/Linie_10/Standard/Route_01.json'];
        lehrfahrer_gtfs_work_write_json($path,['entries'=>[$entry,$entry]]);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Duplikat freigegeben');
        lehrfahrer_gtfs_work_write_json($path,['entries'=>[$entry]]);
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)===null) throw new Exception('Freigabe blockiert');
        if (lehrfahrer_gtfs_work_load_driver_route($company,$legacy)===null) throw new Exception('Nicht-GTFS blockiert');
        $stripped=$route; unset($stripped['meta']['gtfsWork']); file_put_contents($file,json_encode($stripped));
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) throw new Exception('Meta-Strip umgeht Freigabe');
        echo 'OK';`;
      const result = spawnSync(php, ['-r', code], { cwd: root, encoding: 'utf8',
        env: { ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'OK');
    } finally {
      fs.rmSync(privateRoot, { recursive: true, force: true });
    }
  });

test('Driver-Leser wartet auf die gemeinsame Sperre und sieht keine geänderte freigegebene Route',
  { skip: !php && 'PHP nicht verfügbar' }, async () => {
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lehrfahrer-driver-lock-'));
    const env = { ...process.env, LEHRFAHRER_PRIVATE_DATA_DIR: privateRoot };
    const company = 'cmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const prefix = `require ${storage}; require ${work}; $company='${company}';`;
    const setup = spawnSync(php, ['-r', `${prefix}
      $file=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_10','Standard',true);
      $route=['stops'=>[['name'=>'A'],['name'=>'B']], 'routePoints'=>[[51,14],[52,15]],
        'meta'=>['gtfsWork'=>['routeId'=>'route-10','variantId'=>'variant-a']]];
      file_put_contents($file,json_encode($route));
      lehrfahrer_gtfs_work_write_json(lehrfahrer_gtfs_work_inventory_path($company),
        ['entries'=>[['routeId'=>'route-10','variantId'=>'variant-a','status'=>'FREIGEGEBEN',
          'timetableStatus'=>'UNVERAENDERT','savedRoute'=>'cottbus/Linie_10/Standard/Route_01.json']]]);`],
    { cwd: root, env, encoding: 'utf8' });
    try {
      assert.equal(setup.status, 0, setup.stderr);
      const writer = spawn(php, ['-r', `${prefix}
        lehrfahrer_gtfs_work_with_inventory_lock($company, static function() use($company) {
          echo 'LOCKED\\n'; fflush(STDOUT); usleep(500000);
          $path=lehrfahrer_gtfs_work_inventory_path($company);
          $inventory=lehrfahrer_gtfs_work_read_json($path);
          $inventory['entries'][0]['status']='IN_BEARBEITUNG';
          lehrfahrer_gtfs_work_write_json($path,$inventory);
          $file=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_10','Standard');
          $route=lehrfahrer_gtfs_work_read_json($file);
          $route['routePoints'][1]=[53,16];
          $tmp=$file.'.tmp-test'; file_put_contents($tmp,json_encode($route)); rename($tmp,$file);
        });`], { cwd: root, env });
      await new Promise((resolve, reject) => {
        writer.stdout.once('data', chunk => chunk.toString().includes('LOCKED') ? resolve() : reject(new Error('Lock fehlt')));
        writer.once('error', reject);
        writer.once('exit', code => reject(new Error(`Writer beendet: ${code}`)));
      });
      const started = Date.now();
      const reader = spawnSync(php, ['-r', `${prefix}
        $file=lehrfahrer_route_file($company,'cottbus','Route_01','json','Linie_10','Standard');
        if (lehrfahrer_gtfs_work_load_driver_route($company,$file)!==null) exit(2);
        echo 'DENIED';`], { cwd: root, env, encoding: 'utf8', timeout: 5000 });
      assert.equal(reader.status, 0, reader.stderr);
      assert.equal(reader.stdout, 'DENIED');
      assert.ok(Date.now() - started >= 250, 'Driver-Leser hat nicht auf den Writer gewartet');
    } finally {
      fs.rmSync(privateRoot, { recursive: true, force: true });
    }
  });
