<?php
declare(strict_types=1);
/**
 * End-to-end tests against a running API.
 *
 * Point it at a server that already has api/setup.php run against it:
 *     php api/tests/integration.php http://127.0.0.1:8123/api
 *
 * It creates a document, shares it three ways, comments as a guest, and then
 * tries every move each role is NOT allowed to make. Run it against a staging
 * copy, never against live data — it uploads and then deletes its own records,
 * but it does make real writes.
 */

$base = rtrim($argv[1] ?? 'http://127.0.0.1:8123/api', '/');

$pass = 0;
$fail = 0;

function t(string $label, mixed $got, mixed $want): void
{
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "ok   $label\n"; }
    else {
        $fail++;
        echo "FAIL $label\n     got:  " . var_export($got, true)
           . "\n     want: " . var_export($want, true) . "\n";
    }
}
function tt(string $label, bool $cond, string $extra = ''): void
{
    global $pass, $fail;
    if ($cond) { $pass++; echo "ok   $label\n"; }
    else { $fail++; echo "FAIL $label" . ($extra !== '' ? " :: $extra" : '') . "\n"; }
}

/**
 * @param array<string, mixed>|null $json
 * @param array<string, string>     $headers
 * @return array{status:int, body:array<string,mixed>|null, raw:string}
 */
function call(
    string $method,
    string $path,
    ?array $json = null,
    array $headers = [],
    ?array $multipart = null
): array {
    global $base;
    $ch = curl_init($base . '/' . ltrim($path, '/'));
    $h  = [];
    foreach ($headers as $k => $v) { $h[] = "$k: $v"; }

    if ($multipart !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $multipart);
    } elseif ($json !== null) {
        $h[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($json));
    }
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $h);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);

    $raw    = (string) curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $body = json_decode($raw, true);
    return ['status' => $status, 'body' => is_array($body) ? $body : null, 'raw' => $raw];
}

function auth(string $token): array { return ['Authorization' => 'Bearer ' . $token]; }

/** A tiny but structurally valid PDF. */
function samplePdf(): string
{
    $objs = [
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n",
    ];
    $pdf = "%PDF-1.4\n";
    $offsets = [];
    foreach ($objs as $o) { $offsets[] = strlen($pdf); $pdf .= $o; }
    $start = strlen($pdf);
    $pdf .= "xref\n0 4\n0000000000 65535 f \n";
    foreach ($offsets as $off) { $pdf .= sprintf("%010d 00000 n \n", $off); }
    $pdf .= "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n$start\n%%EOF\n";
    return $pdf;
}

echo "Testing $base\n\n";

echo "-- health --\n";
$r = call('GET', 'health');
if ($r['status'] === 0) {
    // Status 0 means the connection never happened. Without this guard the
    // whole suite "runs" against a dead server, and a handful of empty-string
    // comparisons come out green — worse than a hard stop.
    fwrite(STDERR, "\nCannot reach $base — is the server running?\n");
    exit(2);
}
t ('health responds 200',            $r['status'], 200);
tt('health reports ok',              ($r['body']['ok'] ?? false) === true);

echo "\n-- upload --\n";
$tmp = tempnam(sys_get_temp_dir(), 'pdf') . '.pdf';
file_put_contents($tmp, samplePdf());

$r = call('POST', 'documents', null, [], [
    'file'       => new CURLFile($tmp, 'application/pdf', 'integration test.pdf'),
    'title'      => 'Integration test document',
    'page_count' => '1',
    'state'      => json_encode(['v' => 1, 'pages' => []]),
]);
t ('upload responds 201',            $r['status'], 201);
$docId    = $r['body']['id'] ?? '';
$ownerTok = $r['body']['owner_token'] ?? '';
tt('returns a document id',          $docId !== '');
tt('returns an owner token',         $ownerTok !== '');
tt('owner token is 256-bit',         strlen($ownerTok) >= 43);

echo "\n-- rejects bad uploads --\n";
$bad = tempnam(sys_get_temp_dir(), 'bad') . '.pdf';
file_put_contents($bad, '<html>not a pdf at all</html>');
$r = call('POST', 'documents', null, [], [
    'file' => new CURLFile($bad, 'application/pdf', 'evil.pdf'), 'title' => 'x',
]);
t ('non-PDF rejected',               $r['status'], 415);
t ('  with a clear code',            $r['body']['error'] ?? '', 'not_pdf');
@unlink($bad);

echo "\n-- owner access --\n";
$r = call('GET', "documents/$docId", null, auth($ownerTok));
t ('owner can read metadata',        $r['status'], 200);
t ('  role is owner',                $r['body']['role'] ?? '', 'owner');
t ('  title round-trips',            $r['body']['title'] ?? '', 'Integration test document');
t ('  state round-trips',            $r['body']['state']['v'] ?? null, 1);

$r = call('GET', 'resolve', null, auth($ownerTok));
t ('resolve finds the document',     $r['body']['id'] ?? '', $docId);

echo "\n-- rejects bad tokens --\n";
t ('no token is 401',                call('GET', "documents/$docId")['status'], 401);
t ('junk token is 404',              call('GET', "documents/$docId", null, auth('totally-made-up'))['status'], 404);
$r = call('GET', 'documents/' . str_repeat('z', 22), null, auth($ownerTok));
t ('wrong document id is 403',       $r['status'], 403);
t ('malformed id is 400',            call('GET', 'documents/!!', null, auth($ownerTok))['status'], 400);

echo "\n-- file download --\n";
$ch = curl_init("$base/documents/$docId/file?token=" . urlencode($ownerTok));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
$resp   = (string) curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
t ('file responds 200',              $status, 200);
tt('serves a real PDF',              str_contains($resp, '%PDF-'));
tt('sends application/pdf',          stripos($resp, 'Content-Type: application/pdf') !== false);
tt('sets nosniff',                   stripos($resp, 'X-Content-Type-Options: nosniff') !== false);

echo "\n-- shares --\n";
$r = call('POST', "documents/$docId/shares", ['role' => 'comment', 'label' => 'Reviewer'], auth($ownerTok));
t ('owner can create a share',       $r['status'], 201);
$commentTok = $r['body']['token'] ?? '';
tt('share token returned once',      $commentTok !== '');

$r = call('POST', "documents/$docId/shares", ['role' => 'view', 'label' => 'Read only'], auth($ownerTok));
$viewTok = $r['body']['token'] ?? '';
$r = call('POST', "documents/$docId/shares", ['role' => 'edit', 'label' => 'Editor'], auth($ownerTok));
$editTok = $r['body']['token'] ?? '';
tt('three shares issued',            $viewTok !== '' && $editTok !== '' && $commentTok !== '');
tt('every token differs',            count(array_unique([$viewTok, $editTok, $commentTok, $ownerTok])) === 4);

$r = call('GET', "documents/$docId/shares", null, auth($ownerTok));
t ('owner can list shares',          count($r['body']['shares'] ?? []), 3);
$listed = json_encode($r['body']);
tt('listing leaks no token',         !str_contains((string) $listed, $commentTok));
tt('listing leaks no hash',          !str_contains((string) $listed, 'token_hash'));

echo "\n-- share holders cannot manage --\n";
t ('commenter cannot list shares',   call('GET', "documents/$docId/shares", null, auth($commentTok))['status'], 403);
t ('editor cannot list shares',      call('GET', "documents/$docId/shares", null, auth($editTok))['status'], 403);
t ('editor cannot create a share',   call('POST', "documents/$docId/shares", ['role' => 'edit'], auth($editTok))['status'], 403);
t ('commenter cannot delete the doc', call('DELETE', "documents/$docId", null, auth($commentTok))['status'], 403);
t ('editor cannot delete the doc',   call('DELETE', "documents/$docId", null, auth($editTok))['status'], 403);

echo "\n-- reading as a guest --\n";
$r = call('GET', 'resolve', null, auth($commentTok));
t ('guest resolves the document',    $r['body']['id'] ?? '', $docId);
t ('  and learns its role',          $r['body']['role'] ?? '', 'comment');
$r = call('GET', "documents/$docId", null, auth($viewTok));
t ('viewer can read metadata',       $r['status'], 200);
t ('  role is view',                 $r['body']['role'] ?? '', 'view');

echo "\n-- comments --\n";
$guestHdr = auth($commentTok) + ['X-Author-Key' => 'guest-key-one'];
$r = call('POST', "documents/$docId/comments", [
    'kind' => 'markup', 'page_index' => 0, 'body' => 'This dimension looks wrong',
    'quote' => 'Clause 4', 'colour' => '#E2483D',
    'anchor' => ['quads' => [[60, 700, 300, 720]]],
], $guestHdr);
t ('guest can comment',              $r['status'], 201);
$c1 = $r['body']['comment']['id'] ?? '';
tt('comment gets an id',             $c1 !== '');
t ('  anchor round-trips',           $r['body']['comment']['anchor']['quads'][0][0] ?? null, 60);
t ('  colour round-trips',           $r['body']['comment']['colour'] ?? '', '#E2483D');

t ('viewer cannot comment',          call('POST', "documents/$docId/comments",
        ['kind' => 'note', 'body' => 'nope'], auth($viewTok))['status'], 403);

$r = call('POST', "documents/$docId/comments",
    ['kind' => 'reply', 'parent_id' => $c1, 'body' => 'Agreed, will revise'], auth($ownerTok));
t ('owner can reply',                $r['status'], 201);
$replyParent = $r['body']['comment']['parent_id'] ?? '';
tt('  reply is linked to its parent', $c1 !== '' && $replyParent === $c1,
   "parent=$replyParent c1=$c1");

$r = call('GET', "documents/$docId/comments", null, auth($viewTok));
t ('viewer can read comments',       $r['status'], 200);
t ('  sees both',                    count($r['body']['comments'] ?? []), 2);

echo "\n-- comment ownership --\n";
$otherGuest = auth($commentTok) + ['X-Author-Key' => 'guest-key-two'];
$r = call('PATCH', "documents/$docId/comments/$c1", ['body' => 'hijacked'], $otherGuest);
t ('another guest cannot edit it',   $r['status'], 403);
$r = call('DELETE', "documents/$docId/comments/$c1", null, $otherGuest);
t ('another guest cannot delete it', $r['status'], 403);
$r = call('PATCH', "documents/$docId/comments/$c1", ['body' => 'Revised wording'], $guestHdr);
t ('the author can edit it',         $r['status'], 200);
t ('  the edit is stored',           $r['body']['comment']['body'] ?? '', 'Revised wording');

$r = call('PATCH', "documents/$docId/comments/$c1", ['resolved' => true], auth($ownerTok));
t ('owner can resolve',              $r['status'], 200);
tt('  it reads as resolved',         ($r['body']['comment']['resolved'] ?? false) === true);

echo "\n-- incremental sync --\n";
$r = call('GET', "documents/$docId/comments", null, auth($ownerTok));
$serverTime = $r['body']['server_time'] ?? '';
sleep(1);
call('POST', "documents/$docId/comments", ['kind' => 'note', 'page_index' => 0, 'body' => 'Later remark'], auth($ownerTok));
$r = call('GET', "documents/$docId/comments?since=" . urlencode($serverTime), null, auth($ownerTok));
t ('since returns only the new one', count($r['body']['comments'] ?? []), 1);
t ('  and it is the right one',      $r['body']['comments'][0]['body'] ?? '', 'Later remark');

echo "\n-- deletion is a tombstone --\n";
$r = call('GET', "documents/$docId/comments", null, auth($ownerTok));
$before = count($r['body']['comments'] ?? []);
call('DELETE', "documents/$docId/comments/$c1", null, $guestHdr);
$r = call('GET', "documents/$docId/comments", null, auth($ownerTok));
t ('deleted comment disappears',     count($r['body']['comments'] ?? []), $before - 2); // the reply goes too
$r = call('GET', "documents/$docId/comments?since=2000-01-01%2000:00:00", null, auth($ownerTok));
$tombs = array_filter($r['body']['comments'] ?? [], static fn ($c) => !empty($c['deleted']));
tt('but a tombstone is visible',     count($tombs) >= 1);

echo "\n-- document state --\n";
$r = call('PUT', "documents/$docId/state", ['state' => ['v' => 2, 'note' => 'edited'], 'version' => 1], auth($editTok));
t ('editor can save state',          $r['status'], 200);
t ('  version advances',             $r['body']['version'] ?? null, 2);
$r = call('PUT', "documents/$docId/state", ['state' => ['v' => 3], 'version' => 1], auth($editTok));
t ('a stale write is refused',       $r['status'], 409);
t ('  with a conflict code',         $r['body']['error'] ?? '', 'version_conflict');
t ('commenter cannot save state',    call('PUT', "documents/$docId/state",
        ['state' => ['v' => 9], 'version' => 2], auth($commentTok))['status'], 403);

echo "\n-- revoking a link --\n";
$r = call('GET', "documents/$docId/shares", null, auth($ownerTok));
$shareRow = null;
foreach ($r['body']['shares'] as $sh) { if ($sh['label'] === 'Reviewer') { $shareRow = $sh; } }
tt('found the reviewer link',        $shareRow !== null);
call('PATCH', "documents/$docId/shares/" . $shareRow['id'], ['revoked' => true], auth($ownerTok));
$r = call('GET', "documents/$docId", null, auth($commentTok));
t ('a revoked link stops working',   $r['status'], 403);
t ('  and says why',                 $r['body']['error'] ?? '', 'revoked');
call('PATCH', "documents/$docId/shares/" . $shareRow['id'], ['revoked' => false], auth($ownerTok));
t ('and can be turned back on',      call('GET', "documents/$docId", null, auth($commentTok))['status'], 200);

echo "\n-- password-protected link --\n";
$r = call('POST', "documents/$docId/shares",
    ['role' => 'view', 'label' => 'Locked', 'password' => 'hunter2'], auth($ownerTok));
$lockTok = $r['body']['token'] ?? '';
$r = call('GET', "documents/$docId", null, auth($lockTok));
t ('without the password: 401',      $r['status'], 401);
t ('  with a clear code',            $r['body']['error'] ?? '', 'password_required');
$r = call('GET', "documents/$docId", null, auth($lockTok) + ['X-Share-Password' => 'wrong']);
t ('wrong password: 401',            $r['status'], 401);
$r = call('GET', "documents/$docId", null, auth($lockTok) + ['X-Share-Password' => 'hunter2']);
t ('right password: 200',            $r['status'], 200);

echo "\n-- download permission --\n";
$r = call('POST', "documents/$docId/shares", ['role' => 'view', 'allow_download' => false], auth($ownerTok));
$noDl = $r['body']['token'] ?? '';
$ch = curl_init("$base/documents/$docId/file?download=1&token=" . urlencode($noDl));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_exec($ch);
$st = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
t ('download blocked when not allowed', $st, 403);

echo "\n-- cleanup --\n";
t ('owner can delete the document',  call('DELETE', "documents/$docId", null, auth($ownerTok))['status'], 204);
t ('the document is then gone',      call('GET', "documents/$docId", null, auth($ownerTok))['status'], 404);
t ('and its links are dead',         call('GET', 'resolve', null, auth($editTok))['status'], 404);
@unlink($tmp);

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
