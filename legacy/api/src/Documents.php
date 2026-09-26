<?php
declare(strict_types=1);

namespace AddDots;

final class Documents
{
    /**
     * POST /api/documents
     * multipart: file=<the pdf>, title, state (json), page_count
     *
     * Answers with the owner token exactly once. It is never stored in the
     * clear and can never be read back, so the client has to keep it — which
     * is the whole point: losing the owner link loses the document.
     */
    public static function create(): never
    {
        RateLimit::check('upload', 12, 3600);

        $max = (int) Config::get('max_upload_bytes', 48 * 1024 * 1024);

        if (!isset($_FILES['file'])) {
            // An upload larger than post_max_size arrives with $_FILES empty
            // and no error code, which otherwise reads as "no file chosen".
            $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($declared > 0 && $declared > self::phpPostLimit()) {
                throw new ApiException(
                    'That file is larger than this server accepts. The limit is '
                    . self::human(min($max, self::phpPostLimit())) . '.',
                    413,
                    'too_large'
                );
            }
            throw new ApiException('No file was attached.', 422, 'no_file');
        }

        $f = $_FILES['file'];
        if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new ApiException(self::uploadError((int) $f['error']), 422, 'upload_failed');
        }
        if ((int) $f['size'] > $max) {
            throw new ApiException(
                'That file is larger than the ' . self::human($max) . ' limit.',
                413,
                'too_large'
            );
        }
        // is_uploaded_file, not just file_exists: it is the only thing that
        // proves the path came from this request and not from the caller.
        if (!is_uploaded_file((string) $f['tmp_name'])) {
            throw new ApiException('That upload could not be verified.', 400, 'bad_upload');
        }

        $bytes = file_get_contents((string) $f['tmp_name']);
        if ($bytes === false || $bytes === '') {
            throw new ApiException('That upload was empty.', 422, 'empty_file');
        }
        if (!Store::looksLikePdf($bytes)) {
            throw new ApiException('That file is not a PDF.', 415, 'not_pdf');
        }

        $publicId   = Tokens::publicId();
        $ownerToken = Tokens::secret();
        $key        = Store::keyFor($publicId);

        Store::write($key, $bytes);

        $state = $_POST['state'] ?? null;
        if (is_string($state) && strlen($state) > 4 * 1024 * 1024) {
            throw new ApiException('The document markup is too large to store.', 413, 'state_too_large');
        }
        if (is_string($state) && $state !== '' && json_decode($state) === null && json_last_error() !== JSON_ERROR_NONE) {
            throw new ApiException('The document markup was not valid JSON.', 422, 'bad_state');
        }

        $retention = (int) Config::get('retention_days', 180);
        $now = Db::now();

        $id = Db::insert(
            'INSERT INTO documents
               (public_id, owner_hash, title, filename, byte_size, page_count,
                storage_key, sha256, state_json, state_version,
                created_at, updated_at, last_seen_at, expires_at)
             VALUES
               (:pid, :oh, :title, :fn, :size, :pages,
                :key, :sha, :state, 1,
                :now, :now2, :now3, :exp)',
            [
                ':pid'   => $publicId,
                ':oh'    => Tokens::hash($ownerToken),
                ':title' => Http::str($_POST, 'title', 255, false, 'Untitled document'),
                ':fn'    => self::safeName((string) ($f['name'] ?? 'document.pdf')),
                ':size'  => strlen($bytes),
                ':pages' => max(0, min(65535, (int) ($_POST['page_count'] ?? 0))),
                ':key'   => $key,
                ':sha'   => hash('sha256', $bytes),
                ':state' => is_string($state) ? $state : null,
                ':now'   => $now,
                ':now2'  => $now,
                ':now3'  => $now,
                ':exp'   => $retention > 0 ? gmdate('Y-m-d H:i:s', time() + $retention * 86400) : null,
            ]
        );

        Http::send([
            'id'          => $publicId,
            'owner_token' => $ownerToken,
            'title'       => Http::str($_POST, 'title', 255, false, 'Untitled document'),
            'filename'    => self::safeName((string) ($f['name'] ?? 'document.pdf')),
            'byte_size'   => strlen($bytes),
            'page_count'  => (int) ($_POST['page_count'] ?? 0),
            'version'     => 1,
            'created_at'  => $now,
        ], 201);
    }

    /**
     * GET /api/resolve
     *
     * Turn whatever token the caller holds into the document it opens. A share
     * URL deliberately carries no document id — it keeps the link short and
     * tells a shoulder-surfer nothing — so this is the first call a reviewer
     * makes.
     */
    public static function resolve(): never
    {
        RateLimit::check('resolve', 120, 300);
        $a = Access::resolve();
        Http::send([
            'id'           => $a->document['public_id'],
            'title'        => $a->document['title'],
            'role'         => $a->role,
            'can_download' => $a->allowDownload,
        ]);
    }

    /** GET /api/documents/{id} */
    public static function show(string $publicId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);
        $a->countView();

        $d = $a->document;
        $out = [
            'id'          => $d['public_id'],
            'title'       => $d['title'],
            'filename'    => $d['filename'],
            'byte_size'   => (int) $d['byte_size'],
            'page_count'  => (int) $d['page_count'],
            'version'     => (int) $d['state_version'],
            'state'       => $d['state_json'] !== null ? json_decode((string) $d['state_json'], true) : null,
            'role'        => $a->role,
            'can_download'=> $a->allowDownload,
            'created_at'  => $d['created_at'],
            'updated_at'  => $d['updated_at'],
            'expires_at'  => $d['expires_at'],
        ];
        if ($a->isOwner()) {
            $counted = Db::one(
                'SELECT COUNT(*) c FROM shares WHERE document_id = :d AND revoked_at IS NULL',
                [':d' => $a->documentId()]
            );
            $out['share_count'] = (int) ($counted['c'] ?? 0);
        }
        Http::send($out);
    }

    /** GET /api/documents/{id}/file */
    public static function file(string $publicId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);

        $wantsDownload = Http::query('download') === '1';
        if ($wantsDownload && !$a->allowDownload) {
            throw new ApiException('This link does not allow downloading.', 403, 'no_download');
        }

        Store::streamFile(
            (string) $a->document['storage_key'],
            (string) $a->document['filename'],
            $wantsDownload
        );
    }

    /**
     * PUT /api/documents/{id}/state
     *
     * Optimistic locking: the caller sends the version it started from, and a
     * stale write is refused rather than silently clobbering someone else.
     */
    public static function saveState(string $publicId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);
        $a->require(Access::EDIT);
        RateLimit::check('state', 120, 60);

        $body = Http::json();
        if (!array_key_exists('state', $body)) {
            throw new ApiException('No state was sent.', 422, 'missing_state');
        }
        $json = json_encode($body['state'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            throw new ApiException('That state could not be encoded.', 422, 'bad_state');
        }
        if (strlen($json) > 4 * 1024 * 1024) {
            throw new ApiException('The document markup is too large to store.', 413, 'state_too_large');
        }

        $have = (int) $a->document['state_version'];
        $sent = isset($body['version']) ? (int) $body['version'] : $have;
        if ($sent !== $have) {
            throw new ApiException(
                'Someone else saved this document while you were working. Reload to pick up their changes.',
                409,
                'version_conflict'
            );
        }

        $next = $have + 1;
        Db::run(
            'UPDATE documents
                SET state_json = :s, state_version = :v, updated_at = :n,
                    title = COALESCE(:t, title)
              WHERE id = :id AND state_version = :have',
            [
                ':s'    => $json,
                ':v'    => $next,
                ':n'    => Db::now(),
                ':t'    => isset($body['title']) ? Http::str($body, 'title', 255, false) : null,
                ':id'   => $a->documentId(),
                ':have' => $have,
            ]
        );

        Http::send(['version' => $next, 'saved_at' => Db::now()]);
    }

    /** DELETE /api/documents/{id} — owner only, and it really does go. */
    public static function destroy(string $publicId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);
        $a->require(Access::OWNER);

        Store::delete((string) $a->document['storage_key']);
        Db::run(
            'UPDATE documents SET deleted_at = :n, state_json = NULL WHERE id = :id',
            [':n' => Db::now(), ':id' => $a->documentId()]
        );
        Db::run('DELETE FROM shares WHERE document_id = :id', [':id' => $a->documentId()]);

        Http::noContent();
    }

    /**
     * The token identifies the document on its own, so the id in the path is
     * confirmation rather than lookup — but a mismatch still means the caller
     * is pointing at the wrong thing, and should hear about it.
     */
    private static function assertSame(Access $a, string $publicId): void
    {
        if (!hash_equals((string) $a->document['public_id'], $publicId)) {
            throw new ApiException('This link is not valid for that document.', 403, 'wrong_document');
        }
    }

    private static function safeName(string $name): string
    {
        $name = basename($name);
        $name = preg_replace('/[^A-Za-z0-9 ._()-]/', '_', $name) ?: 'document.pdf';
        if (!preg_match('/\.pdf$/i', $name)) {
            $name .= '.pdf';
        }
        return mb_substr($name, 0, 255);
    }

    private static function phpPostLimit(): int
    {
        $toBytes = static function (string $v): int {
            $v = trim($v);
            if ($v === '') { return 0; }
            $unit = strtolower(substr($v, -1));
            $n = (int) $v;
            return match ($unit) {
                'g' => $n * 1024 * 1024 * 1024,
                'm' => $n * 1024 * 1024,
                'k' => $n * 1024,
                default => $n,
            };
        };
        $post = $toBytes((string) ini_get('post_max_size'));
        $file = $toBytes((string) ini_get('upload_max_filesize'));
        $vals = array_filter([$post, $file], static fn ($v) => $v > 0);
        return $vals === [] ? PHP_INT_MAX : min($vals);
    }

    private static function human(int $bytes): string
    {
        return $bytes >= 1048576
            ? round($bytes / 1048576) . ' MB'
            : round($bytes / 1024) . ' KB';
    }

    private static function uploadError(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE =>
                'That file is larger than this server accepts.',
            UPLOAD_ERR_PARTIAL   => 'The upload was cut off. Try again.',
            UPLOAD_ERR_NO_FILE   => 'No file was attached.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE =>
                'The server could not write the upload to disk.',
            UPLOAD_ERR_EXTENSION => 'A server extension blocked the upload.',
            default              => 'The upload failed.',
        };
    }
}
