<?php
declare(strict_types=1);

/**
 * One-time installer.
 *
 * Open this in a browser once, check everything is green, then DELETE THIS
 * FILE. It refuses to run at all if the tables already hold data, so a second
 * visit cannot wipe anything, but it still has no business staying on a live
 * server.
 */

namespace AddDots;

ini_set('display_errors', '0');
error_reporting(E_ALL);

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'AddDots\\')) { return; }
    $file = __DIR__ . '/src/' . substr($class, 8) . '.php';
    if (is_file($file)) { require_once $file; }
});
require_once __DIR__ . '/src/ApiException.php';

$checks = [];
$fatal  = false;

function check(string $label, bool $ok, string $detail = '', bool $warnOnly = false): void
{
    global $checks, $fatal;
    $checks[] = ['label' => $label, 'ok' => $ok, 'detail' => $detail, 'warn' => $warnOnly];
    if (!$ok && !$warnOnly) { $fatal = true; }
}

// readonly properties and the `never` return type are both 8.1 features.
check('PHP 8.1 or newer', PHP_VERSION_ID >= 80100, 'Found ' . PHP_VERSION);
check('PDO MySQL driver', extension_loaded('pdo_mysql'));
check('JSON extension', extension_loaded('json'));
// mb_substr/mb_strlen truncate names and comments without splitting a
// multi-byte character in half. Without it the API fatals on first use.
check('mbstring extension', extension_loaded('mbstring'));
check('OpenSSL (for random tokens)', function_exists('random_bytes'));

$configFile = __DIR__ . '/config.php';
check('api/config.php exists', is_file($configFile),
    is_file($configFile) ? '' : 'Copy config.example.php to config.php and fill it in.');

$ran = [];
if (!$fatal) {
    try {
        Config::boot($configFile);

        Db::conn();
        check('Database connection', true, (string) Config::get('db')['name']);

        $root = Store::root();
        check('Storage folder writable', is_writable($root), $root);

        $inWebroot = false;
        $docRoot = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
        $realStore = realpath($root);
        if ($docRoot !== false && $realStore !== false) {
            $inWebroot = str_starts_with($realStore, $docRoot);
        }
        check(
            'Storage sits outside public_html',
            !$inWebroot,
            $inWebroot
                ? 'It is inside the web root. A .htaccess deny has been written, but moving it out is safer.'
                : $root,
            true
        );

        // Refuse to touch anything that already holds data.
        $existing = 0;
        try {
            $row = Db::one('SELECT COUNT(*) c FROM documents');
            $existing = (int) ($row['c'] ?? 0);
        } catch (\Throwable) {
            $existing = 0;                    // table simply is not there yet
        }

        if ($existing > 0) {
            check('Schema', true, "Already installed — $existing document(s) stored. Nothing changed.");
        } else {
            $sql = (string) file_get_contents(__DIR__ . '/migrations/001_init.sql');

            // Strip the -- comment lines FIRST. Every CREATE TABLE in the
            // migration sits under a comment header, so splitting on ";" and
            // then skipping chunks that begin with "--" silently skipped the
            // lot — and still reported success.
            $stripped = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;

            $errors = [];
            foreach (array_filter(array_map('trim', explode(';', $stripped))) as $stmt) {
                if ($stmt === '') { continue; }
                try {
                    Db::conn()->exec($stmt);
                } catch (\Throwable $e) {
                    $errors[] = $e->getMessage();
                    continue;
                }
                if (preg_match('/CREATE TABLE IF NOT EXISTS `(\w+)`/i', $stmt, $m) === 1) {
                    $ran[] = $m[1];
                }
            }

            // Then confirm against the database rather than taking the loop's
            // word for it.
            $want  = ['documents', 'shares', 'comments', 'rate_limits'];
            $have  = array_column(Db::all('SHOW TABLES'), 0);
            if ($have === [] || $have === [null]) {
                $have = array_map(
                    static fn (array $r): string => (string) reset($r),
                    Db::all('SHOW TABLES')
                );
            }
            $missing = array_values(array_diff($want, $have));

            check(
                'Schema created',
                $missing === [],
                $missing === []
                    ? implode(', ', $want)
                    : 'Missing: ' . implode(', ', $missing)
                      . ($errors !== [] ? ' — ' . implode(' | ', $errors) : '')
            );
        }

        $post = ini_get('post_max_size');
        $up   = ini_get('upload_max_filesize');
        check('Upload limits', true, "post_max_size=$post, upload_max_filesize=$up — "
            . 'raise these in hPanel → PHP Configuration if you need bigger files.', true);
    } catch (ApiException $e) {
        check('Setup', false, $e->getMessage() . ($e->detail !== '' ? ' (' . $e->detail . ')' : ''));
    } catch (\Throwable $e) {
        check('Setup', false, $e->getMessage());
    }
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add Dots PDF — API setup</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; padding:32px 20px; background:#050505; color:#E4E4E4;
         font:15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif }
  main { max-width:660px; margin:0 auto }
  h1 { font-size:20px; margin:0 0 4px }
  p.sub { color:#8D8D8D; margin:0 0 24px }
  ul { list-style:none; padding:0; margin:0 0 24px }
  li { display:flex; gap:10px; padding:11px 13px; border:1px solid #333; border-radius:9px;
       margin-bottom:8px; background:#181818; align-items:flex-start }
  .m { flex:none; width:18px; text-align:center; font-weight:700 }
  .ok .m { color:#3FB950 } .bad .m { color:#E2483D } .warn .m { color:#D9A441 }
  .lab { font-weight:600 }
  .det { color:#8D8D8D; font-size:13px; word-break:break-word }
  .box { padding:14px 16px; border-radius:9px; margin-bottom:16px }
  .good { background:#0F2A16; border:1px solid #1F5B2E }
  .warnbox { background:#2A1F0B; border:1px solid #6B4E12 }
  code { background:#000; padding:2px 6px; border-radius:4px; font-size:13px }
</style>
</head>
<body><main>
<h1>Add Dots PDF — API setup</h1>
<p class="sub">Checking that this server can run the collaboration backend.</p>

<ul>
<?php foreach ($checks as $c): ?>
  <li class="<?= $c['ok'] ? 'ok' : ($c['warn'] ? 'warn' : 'bad') ?>">
    <span class="m"><?= $c['ok'] ? '✓' : ($c['warn'] ? '!' : '✕') ?></span>
    <span>
      <span class="lab"><?= htmlspecialchars($c['label'], ENT_QUOTES) ?></span>
      <?php if ($c['detail'] !== ''): ?>
        <br><span class="det"><?= htmlspecialchars($c['detail'], ENT_QUOTES) ?></span>
      <?php endif; ?>
    </span>
  </li>
<?php endforeach; ?>
</ul>

<?php if (!$fatal): ?>
  <div class="box good">
    <b>Ready.</b> Now delete <code>api/setup.php</code> from the server — it has
    done its job and should not stay on a live site. Then open the app and use
    <b>Share</b> on any open document.
  </div>
  <div class="box warnbox">
    Check <code>api/config.php</code> has <code>'debug' =&gt; false</code> before you
    hand out any links.
  </div>
<?php else: ?>
  <div class="box warnbox">
    Fix the red items above and reload this page.
  </div>
<?php endif; ?>
</main></body>
</html>
