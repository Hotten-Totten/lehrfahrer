<?php
declare(strict_types=1);
// Streamed over SSH. No application includes, schema factories, sessions or file writes.
function live_inventory(string $root, ?string $expectedVersionSha256=null): array {
    $web = realpath($root);
    if (!$web || !is_dir($web) || str_contains(strtolower(basename($web)), 'staging')) throw new RuntimeException('PUBLIC_ROOT_UNCLEAR');
    $report = ['readOnly'=>true, 'releaseReady'=>false, 'findings'=>[],
        'publicRootSha256'=>hash('sha256',$web), 'files'=>[]];
    foreach (['VERSION','index.php','api/_control_database.php','api/_account_auth.php','.user.ini','.htaccess'] as $file) {
        $path=$web.'/'.$file;
        $report['files'][$file]=is_file($path) && !is_link($path) ? hash_file('sha256',$path) : null;
    }
    $version=is_file($web.'/VERSION') ? trim((string)file_get_contents($web.'/VERSION')) : '';
    $report['version']=preg_match('/^V[0-9]+\.[0-9]+\.[0-9]+$/D',$version) ? $version : null;
    if ($report['version']===null) throw new RuntimeException('PUBLIC_ROOT_VERSION_UNCLEAR');
    if ($expectedVersionSha256!==null && !hash_equals($expectedVersionSha256,(string)$report['files']['VERSION'])) throw new RuntimeException('DOMAIN_TARGET_MAPPING');
    $keys=['LEHRFAHRER_ENV','LEHRFAHRER_PUBLIC_ORIGIN','LEHRFAHRER_PRIVATE_DATA_DIR','LEHRFAHRER_DB_DRIVER',
        'LEHRFAHRER_DB_DSN','LEHRFAHRER_DB_HOST','LEHRFAHRER_DB_PORT','LEHRFAHRER_DB_NAME',
        'LEHRFAHRER_DB_USER','LEHRFAHRER_DB_PASSWORD','LEHRFAHRER_DB_TLS_CA','LEHRFAHRER_DB_TLS_REQUIRED'];
    $config=[];
    foreach ($keys as $key) { $value=getenv($key); if ($value!==false && $value!=='') $config[$key]=$value; }
    $runtime=null;
    if (is_file($web.'/.user.ini') && !is_link($web.'/.user.ini')) {
        $ini=parse_ini_file($web.'/.user.ini',false,INI_SCANNER_RAW);
        $candidate=is_array($ini) ? ($ini['auto_prepend_file']??null) : null;
        if (is_string($candidate) && $candidate!=='') $runtime=realpath($candidate);
    }
    // Recognize only literal putenv calls. Never execute arbitrary runtime PHP.
    $recognized=0;
    if ($runtime && is_file($runtime) && !is_link($runtime) && filesize($runtime)<131072) {
        $text=(string)file_get_contents($runtime);
        $tokens=token_get_all($text); $text='';
        foreach ($tokens as $token) $text.=is_array($token)
            ? (in_array($token[0],[T_COMMENT,T_DOC_COMMENT],true)?'':$token[1]) : $token;
        preg_match_all("~putenv\\(\\s*'([A-Z0-9_]+)=([^'\\\\]*)'\\s*\\)~",$text,$matches,PREG_SET_ORDER);
        foreach ($matches as $match) if (in_array($match[1],$keys,true)) { $config[$match[1]]=$match[2]; $recognized++; }
        preg_match_all("~putenv\\(\\s*'([A-Z0-9_]+)='\\s*\\.\\s*base64_decode\\('([A-Za-z0-9+/=]*)'\\)\\s*\\)~",$text,$matches,PREG_SET_ORDER);
        foreach ($matches as $match) if (in_array($match[1],$keys,true)) {
            $value=base64_decode($match[2],true); if ($value!==false) { $config[$match[1]]=$value; $recognized++; }
        }
        $report['runtimeConfigurationSha256']=hash('sha256',$text);
    }
    $report['runtimeConfiguration']=['prependPresent'=>$runtime!==null && $runtime!==false,'recognizedSettings'=>$recognized,
        'environment'=>$config['LEHRFAHRER_ENV']??'UNSET','originMatchesCanonical'=>($config['LEHRFAHRER_PUBLIC_ORIGIN']??'')==='https://www.lehrfahrer.de'];
    $privateSource=isset($config['LEHRFAHRER_PRIVATE_DATA_DIR']) ? 'EXPLICIT_CONFIGURATION' : 'DEPLOYMENT_CONVENTION';
    $private=realpath($config['LEHRFAHRER_PRIVATE_DATA_DIR']??dirname($web).'/lehrfahrer-private');
    if (!$private || str_starts_with($private.'/',$web.'/') || is_link($config['LEHRFAHRER_PRIVATE_DATA_DIR']??dirname($web).'/lehrfahrer-private')) {
        $report['findings'][]='PRIVATE_ROOT_UNRESOLVED'; return $report;
    }
    $report['privateStorage']=['source'=>$privateSource,'rootSha256'=>hash('sha256',$private),'outsidePublicRoot'=>true,
        'mode'=>sprintf('%04o',fileperms($private)&0777),'areas'=>[]];
    foreach (['control','tenants','personnel','trainings','fahrerunterlagen','backups'] as $area) {
        $path=$private.'/'.$area;
        $report['privateStorage']['areas'][$area]=is_dir($path)&&!is_link($path)
            ? ['present'=>true,'mode'=>sprintf('%04o',fileperms($path)&0777)] : ['present'=>false];
    }
    $backups=$private.'/backups/control-db'; $backupReports=[];
    if (is_dir($backups) && !is_link($backups)) {
        $dirs=glob($backups.'/*',GLOB_ONLYDIR)?:[]; rsort($dirs,SORT_STRING);
        foreach (array_slice($dirs,0,3) as $dir) {
            if (is_link($dir) || !is_file($dir.'/manifest.json') || is_link($dir.'/manifest.json') || filesize($dir.'/manifest.json')>131072) continue;
            $manifest=json_decode((string)file_get_contents($dir.'/manifest.json'),true);
            $dump=$dir.'/control.sql'; $valid=is_array($manifest)&&is_file($dump)&&!is_link($dump)
                && ($manifest['bytes']??-1)===filesize($dump) && is_string($manifest['sha256']??null)
                && hash_equals($manifest['sha256'],(string)hash_file('sha256',$dump));
            $backupReports[]=['manifestAndDumpValid'=>$valid,'schemaVersion'=>is_int($manifest['schema_version']??null)?$manifest['schema_version']:null,
                'clientValidated'=>($manifest['restore']['client_validated']??false)===true,'restoreDrillVerified'=>false];
        }
        $report['backupDirectoryCount']=count($dirs);
    }
    $report['recentDatabaseBackups']=$backupReports;
    $report['fullDatabaseAndFilesRestoreVerified']=false;
    if (($config['LEHRFAHRER_ENV']??'')!=='production') { $report['findings'][]='EXPLICIT_PRODUCTION_ENVIRONMENT_MISSING'; return $report; }
    if (($config['LEHRFAHRER_DB_DRIVER']??'mysql')!=='mysql') { $report['findings'][]='DATABASE_DRIVER_UNCLEAR'; return $report; }
    $dsn=$config['LEHRFAHRER_DB_DSN']??'';
    if ($dsn==='') {
        if (empty($config['LEHRFAHRER_DB_HOST']) || empty($config['LEHRFAHRER_DB_NAME'])) { $report['findings'][]='DATABASE_CONFIGURATION_UNRESOLVED'; return $report; }
        $port=$config['LEHRFAHRER_DB_PORT']??'3306';
        if (!ctype_digit($port)||(int)$port<1||(int)$port>65535) throw new RuntimeException('DATABASE_PORT');
        $dsn='mysql:host='.$config['LEHRFAHRER_DB_HOST'].';port='.$port.';dbname='.$config['LEHRFAHRER_DB_NAME'].';charset=utf8mb4';
    }
    if (!str_starts_with($dsn,'mysql:') || empty($config['LEHRFAHRER_DB_USER']) || empty($config['LEHRFAHRER_DB_PASSWORD'])) {
        $report['findings'][]='DATABASE_CONFIGURATION_UNRESOLVED'; return $report;
    }
    preg_match('/(?:^|;)dbname=([^;]+)/',substr($dsn,6),$dbMatch);
    if (empty($dbMatch[1])) throw new RuntimeException('DATABASE_NAME');
    $options=[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false];
    $ca=$config['LEHRFAHRER_DB_TLS_CA']??'';
    if ($ca!=='') { $options[PDO::MYSQL_ATTR_SSL_CA]=$ca; $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT]=true; }
    if (filter_var($config['LEHRFAHRER_DB_TLS_REQUIRED']??false,FILTER_VALIDATE_BOOL) && $ca==='') throw new RuntimeException('DATABASE_TLS_CONFIGURATION');
    $pdo=new PDO($dsn,$config['LEHRFAHRER_DB_USER'],$config['LEHRFAHRER_DB_PASSWORD'],$options);
    $pdo->exec('SET SESSION TRANSACTION READ ONLY');
    $pdo->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'); $pdo->beginTransaction();
    try {
        if (!hash_equals($dbMatch[1],(string)$pdo->query('SELECT DATABASE()')->fetchColumn())) throw new RuntimeException('DATABASE_IDENTITY');
        $query=$pdo->prepare('SELECT value FROM control_metadata WHERE `key`=?'); $query->execute(['environment']);
        if ($query->fetchColumn()!=='production') throw new RuntimeException('DATABASE_ENVIRONMENT');
        $report['database']=['identitySha256'=>hash('sha256',$dsn),'environmentVerified'=>true,'transactionReadOnly'=>true,'counts'=>[]];
        foreach (['auth_mode','auth_cutover_lock'] as $key) {
            $query->execute([$key]); $value=$query->fetchColumn();
            $report['database'][$key]=in_array($value,['PARALLEL','ACCOUNT_PRIMARY','OPEN','LOCKED'],true)?$value:'UNSET';
        }
        $tables=$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        foreach (['companies','users','roles','user_roles','accounts','account_memberships','membership_roles','sysop_assignment','account_passkeys','sessions','account_sessions'] as $table) {
            if (in_array($table,$tables,true)) $report['database']['counts'][$table]=(int)$pdo->query('SELECT COUNT(*) FROM `'.$table.'`')->fetchColumn();
        }
        foreach (['users','accounts'] as $table) if (in_array($table,$tables,true)) {
            $report['database'][$table.'DuplicateLoginGroups']=(int)$pdo->query('SELECT COUNT(*) FROM (SELECT LOWER(TRIM(login_normalized)) FROM `'.$table.'` GROUP BY LOWER(TRIM(login_normalized)) HAVING COUNT(*)>1) duplicates')->fetchColumn();
        }
        $report['database']['schemaVersion']=in_array('schema_migrations',$tables,true)?(int)$pdo->query('SELECT COALESCE(MAX(version),0) FROM schema_migrations')->fetchColumn():null;
    } finally { if ($pdo->inTransaction()) $pdo->rollBack(); }
    return $report;
}

if (realpath((string)($_SERVER['SCRIPT_FILENAME']??''))===__FILE__ || (getenv('LEHRFAHRER_STREAMED_LIVE_READONLY')==='1')) {
    try {
        if (isset($_SERVER['REQUEST_METHOD']) || !in_array(PHP_SAPI,['cli','cgi-fcgi'],true)) throw new RuntimeException('CLI_ONLY');
        $expected=$argv[2]??'';
        if (!preg_match('/^[a-f0-9]{64}$/D',$expected)) throw new RuntimeException('EXPECTED_PUBLIC_VERSION_REQUIRED');
        echo json_encode(live_inventory($argv[1]??'',$expected),JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES),"\n";
    } catch (Throwable $e) {
        echo json_encode(['readOnly'=>true,'releaseReady'=>false,'findings'=>['LIVE_READONLY_INSPECTION_BLOCKED']],JSON_THROW_ON_ERROR),"\n";
        exit(2);
    }
}
