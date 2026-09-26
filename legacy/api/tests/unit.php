<?php
declare(strict_types=1);
/**
 * Unit tests for the parts of the API that need no database.
 *
 * Run from the project root:
 *     php api/tests/unit.php
 *
 * These cover the places where a quiet bug is expensive: token handling, path
 * routing, the access-role ladder, and every sanitiser standing between a
 * request and the filesystem or a response header.
 */

namespace AddDots;

$root = dirname(__DIR__);
spl_autoload_register(static function (string $c) use ($root): void {
    if (!str_starts_with($c, 'AddDots\\')) { return; }
    $f = $root . '/src/' . substr($c, 8) . '.php';
    if (is_file($f)) { require_once $f; }
});
require_once $root . '/src/ApiException.php';

$pass = 0;
$fail = 0;

function t(string $label, mixed $got, mixed $want): void
{
    global $pass, $fail;
    if ($got === $want) {
        $pass++; echo "ok   $label\n";
    } else {
        $fail++;
        echo "FAIL $label\n     got:  " . var_export($got, true)
           . "\n     want: " . var_export($want, true) . "\n";
    }
}

function tt(string $label, bool $cond): void
{
    global $pass, $fail;
    if ($cond) { $pass++; echo "ok   $label\n"; }
    else       { $fail++; echo "FAIL $label\n"; }
}

echo "-- tokens --\n";
$s = Tokens::secret();
tt('secret is url-safe',            preg_match('/^[A-Za-z0-9_-]+$/', $s) === 1);
tt('secret carries 256 bits',       strlen($s) >= 43);
tt('two secrets differ',            Tokens::secret() !== Tokens::secret());
t ('hash is sha256 hex',            strlen(Tokens::hash($s)), 64);
tt('token matches its own hash',    Tokens::matches($s, Tokens::hash($s)));
tt('a wrong token is rejected',     !Tokens::matches('nope', Tokens::hash($s)));
$pid = Tokens::publicId();
t ('public id length',              strlen($pid), 22);
tt('public id is url-safe',         preg_match('/^[A-Za-z0-9_-]{22}$/', $pid) === 1);
tt('public id passes route guard',  preg_match('/^[A-Za-z0-9_-]{8,32}$/', $pid) === 1);

echo "\n-- storage keys --\n";
t ('key is sharded by prefix',      Store::keyFor('abcdefgh1234'), 'ab/abcdefgh1234.pdf');
tt('generated key has no dot-dot',  !str_contains(Store::keyFor($pid), '..'));
$traversed = Store::keyFor('../../etc/passwd');
tt('traversal is neutralised',      !str_contains($traversed, '..') && !str_contains($traversed, 'etc/'));
t ('traversal collapses to a name', $traversed, 'et/etcpasswd.pdf');
try { Store::keyFor('ab'); tt('short id rejected', false); }
catch (ApiException) { tt('short id rejected', true); }

echo "\n-- upload sniffing --\n";
tt('accepts a real PDF header',     Store::looksLikePdf("%PDF-1.7\n1 0 obj"));
tt('accepts a padded header',       Store::looksLikePdf(str_repeat("\x00", 200) . '%PDF-1.4'));
tt('rejects HTML',                  !Store::looksLikePdf('<html><body>hello</body></html>'));
tt('rejects a script upload',       !Store::looksLikePdf('<' . '?php echo 1;'));
tt('rejects a zip',                 !Store::looksLikePdf("PK\x03\x04" . str_repeat('x', 100)));
tt('rejects an empty upload',       !Store::looksLikePdf(''));

echo "\n-- filename hardening --\n";
$rm = new \ReflectionMethod(Documents::class, 'safeName');
$rm->setAccessible(true);
$safe = static fn (string $n): string => $rm->invoke(null, $n);
t ('keeps a normal name',           $safe('Door Schedule R0.pdf'), 'Door Schedule R0.pdf');
t ('strips a path',                 $safe('../../../etc/passwd.pdf'), 'passwd.pdf');
t ('adds a missing extension',      $safe('report'), 'report.pdf');
t ('neutralises a quote',           $safe('a"b.pdf'), 'a_b.pdf');
/* What matters is that no CR or LF survives into a Content-Disposition
   header, not the exact substitution the regex happens to make. */
$injected = $safe("x\r\nSet-Cookie: a=b.pdf");
tt('drops CR and LF',               !str_contains($injected, "\r") && !str_contains($injected, "\n"));
tt('drops the quote and colon',     !str_contains($injected, '"') && !str_contains($injected, ':'));
t ('injection is defanged',         $injected, 'x__Set-Cookie_ a_b.pdf');

echo "\n-- byte formatting --\n";
$rh = new \ReflectionMethod(Documents::class, 'human');
$rh->setAccessible(true);
t ('formats MB',                    $rh->invoke(null, 48 * 1024 * 1024), '48 MB');
t ('formats KB',                    $rh->invoke(null, 500 * 1024), '500 KB');

echo "\n-- request routing --\n";
$route = static function (string $uri, string $script = '/api/index.php'): string {
    $_SERVER['REQUEST_URI'] = $uri;
    $_SERVER['SCRIPT_NAME'] = $script;
    return Http::path();
};
t ('root path',                     $route('/api/'), '');
t ('collection',                    $route('/api/documents'), 'documents');
t ('nested resource',               $route('/api/documents/abc123/comments'), 'documents/abc123/comments');
t ('query string ignored',          $route('/api/documents/abc?since=x'), 'documents/abc');
t ('works in a subfolder',          $route('/pdfreader/api/documents/xy', '/pdfreader/api/index.php'), 'documents/xy');
t ('percent escapes decoded',       $route('/api/documents/a%2Db'), 'documents/a-b');

echo "\n-- bearer token --\n";
$_GET = [];
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer abc.def-123';
t ('reads the Authorization header', Http::bearer(), 'abc.def-123');
$_SERVER['HTTP_AUTHORIZATION'] = 'Basic zzz';
$_GET['token'] = 'from-query';
t ('falls back to the query',       Http::bearer(), 'from-query');
unset($_GET['token']);
$_SERVER['HTTP_AUTHORIZATION'] = '';
t ('no token means null',           Http::bearer(), null);

echo "\n-- client ip --\n";
$_SERVER['REMOTE_ADDR'] = '10.0.0.5';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.9, 10.1.1.1';
t ('takes the first forwarded hop', Http::clientIp(), '203.0.113.9');
$_SERVER['HTTP_X_FORWARDED_FOR'] = 'not-an-ip';
t ('falls back on a junk header',   Http::clientIp(), '10.0.0.5');

echo "\n-- field reading --\n";
t ('trims whitespace',              Http::str(['a' => '  hi  '], 'a', 50), 'hi');
t ('truncates to the limit',        Http::str(['a' => str_repeat('x', 80)], 'a', 10), str_repeat('x', 10));
t ('uses the default',              Http::str([], 'a', 10, false, 'dflt'), 'dflt');
try { Http::str([], 'a', 10); tt('a required field throws', false); }
catch (ApiException) { tt('a required field throws', true); }

echo "\n-- access ladder --\n";
$mk = static function (string $role): Access {
    $rc = new \ReflectionClass(Access::class);
    $o  = $rc->newInstanceWithoutConstructor();
    $set = ['document' => ['id' => 1, 'public_id' => 'x'], 'role' => $role,
            'share' => null, 'allowDownload' => true];
    foreach ($set as $k => $v) {
        $p = $rc->getProperty($k);
        $p->setAccessible(true);
        $p->setValue($o, $v);
    }
    return $o;
};
$can = static function (string $has, string $needs) use ($mk): bool {
    try { $mk($has)->require($needs); return true; }
    catch (ApiException) { return false; }
};
tt('viewer cannot comment',         !$can('view', Access::COMMENT));
tt('viewer cannot edit',            !$can('view', Access::EDIT));
tt('commenter can comment',         $can('comment', Access::COMMENT));
tt('commenter cannot edit',         !$can('comment', Access::EDIT));
tt('commenter is not the owner',    !$can('comment', Access::OWNER));
tt('editor can comment',            $can('edit', Access::COMMENT));
tt('editor can edit',               $can('edit', Access::EDIT));
tt('editor is not the owner',       !$can('edit', Access::OWNER));
tt('owner can do everything',       $can('owner', Access::OWNER)
                                    && $can('owner', Access::EDIT)
                                    && $can('owner', Access::COMMENT));

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
