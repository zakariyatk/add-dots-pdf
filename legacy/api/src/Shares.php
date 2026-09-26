<?php
declare(strict_types=1);

namespace AddDots;

final class Shares
{
    /** GET /api/documents/{id}/shares — owner only */
    public static function index(string $publicId): never
    {
        $a = Access::resolve();
        $a->require(Access::OWNER);
        self::assertSame($a, $publicId);

        // Never select token_hash or password_hash — the owner gets to know a
        // link exists and whether it is protected, not what it is.
        $rows = Db::all(
            'SELECT id, label, role, allow_download, expires_at, revoked_at,
                    view_count, last_view_at, created_at,
                    (password_hash IS NOT NULL AND LENGTH(password_hash) > 0) AS has_password
               FROM shares
              WHERE document_id = :d
              ORDER BY created_at DESC',
            [':d' => $a->documentId()]
        );

        Http::send(['shares' => array_map(static function (array $r): array {
            return [
                'id'             => (int) $r['id'],
                'label'          => $r['label'],
                'role'           => $r['role'],
                'allow_download' => (bool) (int) $r['allow_download'],
                'has_password'   => (bool) (int) $r['has_password'],
                'expires_at'     => $r['expires_at'],
                'revoked'        => $r['revoked_at'] !== null,
                'view_count'     => (int) $r['view_count'],
                'last_view_at'   => $r['last_view_at'],
                'created_at'     => $r['created_at'],
            ];
        }, $rows)]);
    }

    /**
     * POST /api/documents/{id}/shares — owner only
     *
     * The token comes back exactly once, here. Afterwards only its hash is on
     * the server, so the list above can show that a link exists but can never
     * show the link itself — lose it and you revoke and reissue.
     */
    public static function create(string $publicId): never
    {
        $a = Access::resolve();
        $a->require(Access::OWNER);
        self::assertSame($a, $publicId);
        RateLimit::check('share', 40, 3600);

        $body = Http::json();

        $role = strtolower(Http::str($body, 'role', 10, false, 'comment'));
        if (!in_array($role, ['view', 'comment', 'edit'], true)) {
            throw new ApiException('Role must be view, comment or edit.', 422, 'bad_role');
        }

        $expiresAt = null;
        $days = isset($body['expires_days']) ? (int) $body['expires_days'] : 0;
        if ($days > 0) {
            $days = min($days, 3650);
            $expiresAt = gmdate('Y-m-d H:i:s', time() + $days * 86400);
        }

        $passwordHash = null;
        $pw = $body['password'] ?? null;
        if (is_string($pw) && $pw !== '') {
            if (strlen($pw) < 4) {
                throw new ApiException('That password is too short.', 422, 'weak_password');
            }
            if (strlen($pw) > 200) {
                throw new ApiException('That password is too long.', 422, 'bad_password');
            }
            $passwordHash = password_hash($pw, PASSWORD_DEFAULT);
        }

        $token = Tokens::secret();

        $id = Db::insert(
            'INSERT INTO shares
               (document_id, token_hash, label, role, password_hash,
                allow_download, expires_at, created_at)
             VALUES (:d, :t, :l, :r, :p, :dl, :e, :n)',
            [
                ':d'  => $a->documentId(),
                ':t'  => Tokens::hash($token),
                ':l'  => Http::str($body, 'label', 120, false),
                ':r'  => $role,
                ':p'  => $passwordHash,
                ':dl' => !empty($body['allow_download']) ? 1 : 0,
                ':e'  => $expiresAt,
                ':n'  => Db::now(),
            ]
        );

        Http::send([
            'id'             => $id,
            'token'          => $token,
            'role'           => $role,
            'label'          => Http::str($body, 'label', 120, false),
            'allow_download' => !empty($body['allow_download']),
            'has_password'   => $passwordHash !== null,
            'expires_at'     => $expiresAt,
            'created_at'     => Db::now(),
        ], 201);
    }

    /** PATCH /api/documents/{id}/shares/{shareId} — owner only */
    public static function update(string $publicId, string $shareId): never
    {
        $a = Access::resolve();
        $a->require(Access::OWNER);
        self::assertSame($a, $publicId);

        $share = self::find($a, (int) $shareId);
        $body  = Http::json();

        $sets = [];
        $args = [':id' => $share['id'], ':d' => $a->documentId()];

        if (array_key_exists('revoked', $body)) {
            $sets[] = 'revoked_at = :rv';
            $args[':rv'] = !empty($body['revoked']) ? Db::now() : null;
        }
        if (array_key_exists('label', $body)) {
            $sets[] = 'label = :l';
            $args[':l'] = Http::str($body, 'label', 120, false);
        }
        if (array_key_exists('allow_download', $body)) {
            $sets[] = 'allow_download = :dl';
            $args[':dl'] = !empty($body['allow_download']) ? 1 : 0;
        }
        if (array_key_exists('role', $body)) {
            $role = strtolower(Http::str($body, 'role', 10, false, 'comment'));
            if (!in_array($role, ['view', 'comment', 'edit'], true)) {
                throw new ApiException('Role must be view, comment or edit.', 422, 'bad_role');
            }
            $sets[] = 'role = :r';
            $args[':r'] = $role;
        }
        if (array_key_exists('expires_days', $body)) {
            $days = (int) $body['expires_days'];
            $sets[] = 'expires_at = :e';
            $args[':e'] = $days > 0 ? gmdate('Y-m-d H:i:s', time() + min($days, 3650) * 86400) : null;
        }
        if (array_key_exists('password', $body)) {
            $pw = $body['password'];
            $sets[] = 'password_hash = :p';
            $args[':p'] = (is_string($pw) && $pw !== '') ? password_hash($pw, PASSWORD_DEFAULT) : null;
        }

        if ($sets === []) {
            throw new ApiException('Nothing to change.', 422, 'no_changes');
        }

        Db::run(
            'UPDATE shares SET ' . implode(', ', $sets) . ' WHERE id = :id AND document_id = :d',
            $args
        );

        Http::send(['ok' => true]);
    }

    /** DELETE /api/documents/{id}/shares/{shareId} — owner only */
    public static function destroy(string $publicId, string $shareId): never
    {
        $a = Access::resolve();
        $a->require(Access::OWNER);
        self::assertSame($a, $publicId);

        $share = self::find($a, (int) $shareId);
        Db::run(
            'DELETE FROM shares WHERE id = :id AND document_id = :d',
            [':id' => $share['id'], ':d' => $a->documentId()]
        );

        Http::noContent();
    }

    /** @return array<string, mixed> */
    private static function find(Access $a, int $shareId): array
    {
        $row = Db::one(
            'SELECT id FROM shares WHERE id = :id AND document_id = :d LIMIT 1',
            [':id' => $shareId, ':d' => $a->documentId()]
        );
        if ($row === null) {
            throw new ApiException('That link does not exist.', 404, 'no_share');
        }
        return $row;
    }

    private static function assertSame(Access $a, string $publicId): void
    {
        if (!hash_equals((string) $a->document['public_id'], $publicId)) {
            throw new ApiException('This link is not valid for that document.', 403, 'wrong_document');
        }
    }
}
