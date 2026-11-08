<?php
declare(strict_types=1);
// Destructive fixtures are permitted only in a new temporary SQLite root or a dedicated empty lf_a8_* database.
if(PHP_SAPI!=='cli'||isset($_SERVER['REQUEST_METHOD']))exit(2);
$fixture=in_array('--fixture',$argv,true);
$provided=trim((string)getenv('LEHRFAHRER_A8_TEST_ROOT'));
$base=$provided!==''?$provided:sys_get_temp_dir().'/lf-a8-new-company-'.bin2hex(random_bytes(8));
if($provided!==''&&(strtolower((string)realpath(dirname($base)))!==strtolower((string)realpath(sys_get_temp_dir()))||!preg_match('/^lf-a8-new-company-[A-Za-z0-9_-]+$/D',basename($base))))throw new RuntimeException('Unsafe fixture root');
mkdir($base.'/webroot',0700,true);
putenv('LEHRFAHRER_PRIVATE_DATA_DIR='.$base.'/private');
putenv('LEHRFAHRER_ENV='.(getenv('LEHRFAHRER_A8_MYSQL')==='1'?'staging':'dev'));
putenv('LEHRFAHRER_PUBLIC_ORIGIN=https://staging.lehrfahrer.de');
if(getenv('LEHRFAHRER_A8_MYSQL')!=='1')putenv('LEHRFAHRER_DB_DRIVER=sqlite');
$_SERVER['DOCUMENT_ROOT']=$base.'/webroot';
require dirname(__DIR__).'/api/_company_provisioning.php';
require_once dirname(__DIR__).'/api/_route_categories.php';
require_once dirname(__DIR__).'/api/_tenant_route_storage.php';
function a8_check(bool $ok,string $message):void{if(!$ok)throw new RuntimeException('A8: '.$message);}
function a8_write(string $path,array $value):void{if(!is_dir(dirname($path)))mkdir(dirname($path),0700,true);file_put_contents($path,json_encode($value,JSON_THROW_ON_ERROR));}
function a8_tree(string $dir):array{
 $out=[];if(!is_dir($dir))return $out;
 foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir,FilesystemIterator::SKIP_DOTS))as $file){
  a8_check(!$file->isLink(),'Unexpected link in isolated fixture');if($file->isFile())$out[substr($file->getPathname(),strlen($dir))]=hash_file('sha256',$file->getPathname());
 }ksort($out);return $out;
}
function a8_counts(PDO $pdo):array{
 $out=[];foreach(['companies','users','user_roles','accounts','account_memberships','membership_roles','account_user_numbers','user_activation_tokens','audit_events']as $table)$out[$table]=(int)$pdo->query('SELECT COUNT(*) FROM '.$table)->fetchColumn();
 $out['next']=(int)$pdo->query('SELECT next_number FROM account_user_number_allocator')->fetchColumn();
 $out['head']=$pdo->query('SELECT last_hash FROM audit_chain_state')->fetchColumn();return $out;
}
function a8_fail_audit(PDO $pdo,string $action):void{
 if(lehrfahrer_control_driver($pdo)==='mysql')$pdo->exec("CREATE TRIGGER a8_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW BEGIN IF NEW.action = '$action' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A8 simulated outage'; END IF; END");
 else $pdo->exec("CREATE TRIGGER a8_fail_audit BEFORE INSERT ON audit_events WHEN NEW.action='$action' BEGIN SELECT RAISE(ABORT,'A8 simulated outage'); END");
}
function a8_new(PDO $pdo,string $suffix):array{
 return lehrfahrer_create_company_from_template($pdo,['name'=>'A8 Test '.$suffix,'slug'=>'a8-test-'.$suffix,'license_status'=>'trial','admin_display_name'=>'A8 Admin '.$suffix,'admin_login'=>'a8-admin-'.$suffix]);
}
$keep=false;
try{
 if(getenv('LEHRFAHRER_A8_MYSQL')==='1'){
  a8_check(!$fixture,'HTTP fixture only supports isolated SQLite');
  a8_check(getenv('LEHRFAHRER_A8_ISOLATED')==='1','Isolated MariaDB approval marker required');
  putenv('LEHRFAHRER_DB_DRIVER=mysql');$cfg=lehrfahrer_control_mysql_configuration();$probe=new PDO($cfg['dsn'],$cfg['user'],$cfg['password'],$cfg['options']);
  a8_check(preg_match('/^lf_a8_[a-f0-9]+$/D',(string)$probe->query('SELECT DATABASE()')->fetchColumn())===1,'Dedicated test database required');
  a8_check((int)$probe->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchColumn()===0,'MariaDB fixture must be empty');
 }
 $pdo=lehrfahrer_control_database();
 $q=$pdo->prepare('SELECT value FROM control_metadata WHERE `key`=?');$q->execute(['auth_mode']);
 if($q->fetchColumn()===false)$pdo->prepare('INSERT INTO control_metadata(`key`,value,updated_at)VALUES(?,?,?)')->execute(['auth_mode','ACCOUNT_PRIMARY',gmdate('c')]);
 else $pdo->exec("UPDATE control_metadata SET value='ACCOUNT_PRIMARY' WHERE `key`='auth_mode'");
 $a=a8_new($pdo,'a');$ca=$a['company']['id'];
 lehrfahrer_activate_company_admin($pdo,$a['activation']['token'],'A8-Isolated-Password-123!');
 $driverA='drv_'.str_repeat('a',32);$packageA='pkg_'.str_repeat('a',32);
 a8_write(lehrfahrer_tenant_path($ca,'drivers','drivers.json',true),[['id'=>$driverA,'firstName'=>'A8_FOREIGN','note'=>'A8_FOREIGN_NOTE']]);
 a8_write(lehrfahrer_tenant_path($ca,'trainings','training_000999.json',true),['trainingId'=>'training_000999','driverId'=>$driverA,'status'=>'created','created'=>gmdate('c'),'notes'=>'A8_FOREIGN_NOTE','routes'=>[]]);
 a8_write(lehrfahrer_tenant_path($ca,'packages',$packageA.'/paket.json',true),['id'=>$packageA,'driverName'=>'A8_FOREIGN','documents'=>[]]);
 $doc=lehrfahrer_tenant_path($ca,'documents',$packageA.'/foreign.pdf',true);file_put_contents($doc,'%PDF A8_FOREIGN');
 lehrfahrer_route_register_city($ca,'a8-foreign-city');
 a8_write(lehrfahrer_tenant_path($ca,'lines','a8-foreign-city/Foreign.json',true),['lineName'=>'A8_FOREIGN','remark'=>'A8_FOREIGN_NOTE','stops'=>[]]);
 a8_write(lehrfahrer_tenant_path($ca,'settings','city_settings.json',true),['a8-foreign-city'=>['dispatchPhone'=>'A8_FOREIGN_PHONE']]);
 a8_write(lehrfahrer_tenant_path($ca,'catalogs','foreign.json',true),['note'=>'A8_FOREIGN_NOTE']);
 a8_write(lehrfahrer_tenant_path($ca,'imports','foreign.json',true),['note'=>'A8_FOREIGN_NOTE']);
 a8_write($base.'/private/personnel/drivers.json',[['id'=>$driverA,'firstName'=>'A8_LEGACY_FOREIGN']]);
 $beforeA=a8_tree(lehrfahrer_tenant_root($ca));
 lehrfahrer_company_cleanup_failed_provision($pdo,$ca);
 a8_check(a8_tree(lehrfahrer_tenant_root($ca))===$beforeA,'Cleanup removed a committed tenant');
 $b=a8_new($pdo,'b');$cb=$b['company']['id'];
 $files=a8_tree(lehrfahrer_tenant_root($cb));
 a8_check(count($files)===1&&isset($files[DIRECTORY_SEPARATOR.'settings'.DIRECTORY_SEPARATOR.'company.json']),'New company must contain only its own company config');
 foreach(LEHRFAHRER_TENANT_AREAS as $area)a8_check(is_dir(lehrfahrer_tenant_area($cb,$area)),'Tenant area missing');
 $config=json_decode(file_get_contents(lehrfahrer_tenant_path($cb,'settings','company.json')),true,512,JSON_THROW_ON_ERROR);
 a8_check(($config['defaults']['system_settings']['operations']['dispatch_phone']??null)===null,'Foreign phone copied');
 a8_check(!str_contains(json_encode($config),'A8_FOREIGN'),'Foreign notes copied');
 a8_check(count(lehrfahrer_route_category_defaults())===8,'Standard categories missing');
 $query=$pdo->prepare('SELECT a.id,a.active,m.status,m.id AS membership_id FROM account_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.company_id=? AND m.legacy_user_id=?');
 $query->execute([$cb,$b['admin']['id']]);$accountB=$query->fetchAll(PDO::FETCH_ASSOC);
 a8_check(count($accountB)===1&&(int)$accountB[0]['active']===0&&$accountB[0]['status']==='inactive','New administrator account missing or prematurely active');
 $role=$pdo->prepare('SELECT r.code FROM membership_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.membership_id=?');$role->execute([$accountB[0]['membership_id']]);a8_check($role->fetchAll(PDO::FETCH_COLUMN)===['ADMIN'],'Default admin role missing');
 a8_check(lehrfahrer_account_platform_capabilities($pdo,$accountB[0]['id'])===[],'Unexpected platform rights');
 a8_check(lehrfahrer_control_user_number_for_account($pdo,$accountB[0]['id'])===102,'Global user-number allocator reset or skipped');
 // Every critical provisioning event must fail atomically, including global allocator state.
 foreach(['ACCOUNT_CREATE','MEMBERSHIP_CHANGE','TENANT_ROLE_ASSIGN']as $index=>$action){
  $counts=a8_counts($pdo);$roots=glob($base.'/private/companies/cmp_*')?:[];a8_fail_audit($pdo,$action);
  $failed=false;try{a8_new($pdo,'failed-'.$index);}catch(LehrfahrerAuditWriteFailure $e){$failed=true;}finally{$pdo->exec('DROP TRIGGER a8_fail_audit');}
  a8_check($failed&&a8_counts($pdo)===$counts&&(glob($base.'/private/companies/cmp_*')?:[])===$roots,'Provisioning audit failure left partial state');
 }
 // Reusing another company's global login must never attach its account.
 $counts=a8_counts($pdo);$failed=false;
 try{lehrfahrer_create_company_from_template($pdo,['name'=>'A8 Collision','slug'=>'a8-collision','license_status'=>'trial','admin_display_name'=>'X','admin_login'=>'a8-admin-a']);}catch(PDOException $e){$failed=true;}
 a8_check($failed&&a8_counts($pdo)===$counts,'Global login collision was not rejected atomically');
 $q=$pdo->prepare('SELECT value FROM control_metadata WHERE `key`=?');$q->execute(['auth_cutover_lock']);
 if($q->fetchColumn()===false)$pdo->prepare('INSERT INTO control_metadata(`key`,value,updated_at)VALUES(?,?,?)')->execute(['auth_cutover_lock','OPEN',gmdate('c')]);
 $counts=a8_counts($pdo);$pdo->exec("UPDATE control_metadata SET value='LOCKED' WHERE `key`='auth_cutover_lock'");
 $blocked=0;
 try{
  try{a8_new($pdo,'locked');}catch(LehrfahrerAuthCutoverBusy $e){$blocked++;}
  try{lehrfahrer_activate_company_admin($pdo,$b['activation']['token'],'A8-Isolated-Password-123!');}catch(LehrfahrerAuthCutoverBusy $e){$blocked++;}
 }finally{$pdo->exec("UPDATE control_metadata SET value='OPEN' WHERE `key`='auth_cutover_lock'");}
 a8_check($blocked===2&&a8_counts($pdo)===$counts,'Cutover gate allowed provisioning or activation');
 $_SERVER['REQUEST_METHOD']='POST';$blocked=false;
 try{a8_new($pdo,'http');}catch(RuntimeException $e){$blocked=true;}finally{unset($_SERVER['REQUEST_METHOD']);}
 a8_check($blocked&&a8_counts($pdo)===$counts,'HTTP provisioning accepted');
 foreach(['AUTH_ACCOUNT_ACTIVATE','AUTH_MEMBERSHIP_ACTIVATE']as $action){
  $counts=a8_counts($pdo);a8_fail_audit($pdo,$action);$failed=false;
  try{lehrfahrer_activate_company_admin($pdo,$b['activation']['token'],'A8-Isolated-Password-123!');}catch(LehrfahrerAuditWriteFailure $e){$failed=true;}finally{$pdo->exec('DROP TRIGGER a8_fail_audit');}
  a8_check($failed&&a8_counts($pdo)===$counts,'Activation audit failure left partial state');
  $query->execute([$cb,$b['admin']['id']]);$check=$query->fetch(PDO::FETCH_ASSOC);
  a8_check((int)$check['active']===0&&$check['status']==='inactive','Failed activation enabled account');
  $legacy=$pdo->prepare('SELECT active FROM users WHERE id=?');$legacy->execute([$b['admin']['id']]);a8_check((int)$legacy->fetchColumn()===0,'Failed activation enabled legacy user');
 }
 lehrfahrer_activate_company_admin($pdo,$b['activation']['token'],'A8-Isolated-Password-123!');
 $replayed=false;try{lehrfahrer_activate_company_admin($pdo,$b['activation']['token'],'Another-Password-123!');}catch(DomainException $e){$replayed=true;}
 a8_check($replayed,'Activation token replay accepted');
 $aLogin=lehrfahrer_account_login($pdo,'a8-admin-a','A8-Isolated-Password-123!');
 $bLogin=lehrfahrer_account_login($pdo,'a8-admin-b','A8-Isolated-Password-123!');
 a8_check(is_array($aLogin)&&is_array($bLogin),'Account login after activation failed');
 $_COOKIE[LEHRFAHRER_ACCOUNT_TEST_COOKIE]=$bLogin['token'];$session=lehrfahrer_account_current_session($pdo,false);$public=lehrfahrer_account_public_session($pdo,$session);
 a8_check($public['companyId']===$cb&&in_array('drivers.manage',$public['tenantCapabilities'],true),'New admin does not have its own active company');
 a8_check(a8_tree(lehrfahrer_tenant_root($ca))===$beforeA,'Existing company changed');
 a8_check(a8_tree(lehrfahrer_tenant_root($cb))===$files,'Activation or login copied business data');
 a8_check(lehrfahrer_audit_verify_chain($pdo),'Audit chain invalid');
 $result=['ok'=>true,'newCompanyEmpty'=>true,'adminAccountAndRolesValid'=>true,'standardCategoriesPresent'=>true,
  'accountActivationAndLoginValid'=>true,'auditFailuresAtomic'=>true,'activationReplayRejected'=>true,'globalLoginCollisionRejected'=>true,'existingCompanyUnchanged'=>true,'auditChainValid'=>true];
 if($fixture){$result['fixture']=['base'=>$base,'companyA'=>$ca,'companyB'=>$cb,'driverA'=>$driverA,'packageA'=>$packageA,
  'cookieA'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$aLogin['token'],'cookieB'=>LEHRFAHRER_ACCOUNT_TEST_COOKIE.'='.$bLogin['token'],'csrfA'=>$aLogin['csrf'],'csrfB'=>$bLogin['csrf']];$keep=true;}
 echo json_encode($result,JSON_THROW_ON_ERROR)."\n";
}finally{
 if(!$keep&&$provided===''&&is_dir($base)){
  $real=realpath($base);a8_check($real!==false&&str_starts_with(str_replace('\\','/',$real),rtrim(str_replace('\\','/',sys_get_temp_dir()),'/').'/lf-a8-new-company-'),'Unsafe test cleanup target');
  foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST)as $file){if($file->isDir()&&!$file->isLink())rmdir($file->getPathname());else unlink($file->getPathname());}rmdir($base);
 }
}
