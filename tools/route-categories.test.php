<?php
declare(strict_types=1);
require dirname(__DIR__).'/api/_route_categories.php';
$base=sys_get_temp_dir().'/lf-category-'.bin2hex(random_bytes(8));
$file=$base.'/categories.json';
try{
 foreach(['a/b','a\\b','../secret','a<b',"a\0b",str_repeat('a',81),"\xff"]as $name){
  $rejected=false;try{lehrfahrer_route_categories_add($file,$name);}catch(InvalidArgumentException $e){$rejected=true;}
  if(!$rejected)throw new RuntimeException('Invalid category accepted');
 }
 $categories=lehrfahrer_route_categories_add($file,'  Eigene   Kategorie  ');
 if(!in_array('Eigene Kategorie',$categories,true))throw new RuntimeException('Valid category missing');
 $before=file_get_contents($file);
 lehrfahrer_route_categories_add($file,'eigene kategorie');
 if(file_get_contents($file)!==$before)throw new RuntimeException('Case duplicate changed categories');
 echo "PASS category input boundaries and valid names\n";
}finally{
 if(is_file($file))unlink($file);
 if(is_file($base.'/.route-categories.lock'))unlink($base.'/.route-categories.lock');
 if(is_dir($base))rmdir($base);
}
