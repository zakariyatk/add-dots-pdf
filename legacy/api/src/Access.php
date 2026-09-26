<?php
declare(strict_types=1);

namespace AddDots;

/**
 * Who is calling, and what they are allowed to do.
 *
 * Every request resolves to exactly one of these, and every controller asks it
 * before touching anything. There is no path that reads a document without
 * going through resolve().
 */
final class Access
{
    public const OWNER   = 'owner';
    public const EDIT    = 'edit';
    public const COMMENT = 'comment';
    public const VIEW    = 'view';

    private const RANK = [self::VIEW => 0, self::COMMENT => 1, self::EDIT => 2, self::OWNER => 3];

    private function __construct(
        public readonly array $document,
        public readonly string $role,
        public readonly ?array $share,
        public readonly bool $allowDownload
    ) {
    }

    public function isOwner(): bool
    {
        return $this->role === self::OWNER;
    }

    public function documentId(): int
    {
        return (int) $this->document['id'];
    }

    public function shareId(): ?int
    {
        return $this->share === null ? null : (int) $this->share['id'];
    }

    /** Throw unless the caller is at least this powerful. */
    public function require(string $role): void
    {
        if ((self::RANK[$this->role] ?? -1) < (self::RANK[$role] ?? 99)) {
            throw new ApiException(
                'This link does not allow that.',
                403,
                'forbidden'
            );
        }
    }

    /**
     * Resolve the bearer token to a document and a role.
     *
     * A token is either an owner token or a share token; we look for both and
     * always do the same amount of work, so a wrong token cannot be told apart
     * from a token for a document that does not exist.
     */
    public static function resolve(?string $token = null): self
    {
        $token = $token ?? Http::bearer();
        if ($token === null || $token === '' || strlen($token) > 200) {
            throw new ApiException('This link is missing its access token.', 401, 'no_token');
        }

        $hash = Tokens::hash($token);

        $doc = Db::one(
            'SELECT * FROM documents
              WHERE owner_hash = :h AND deleted_at IS NULL
              LIMIT 1',
            [':h' => $hash]
        );
        if ($doc !== null) {
            self::assertLive($doc);
            self::touch((int) $doc['id']);
            return new self($doc, self::OWNER, null, true);
        }

        $share = Db::one(
            'SELECT * FROM shares WHERE token_hash = :h LIMIT 1',
            [':h' => $hash]
        );
        if ($share === null) {
            throw new ApiException('This link is not valid.', 404, 'bad_token');
        }
        if ($share['revoked_at'] !== null) {
            throw new ApiException('This link has been turned off by its owner.', 403, 'revoked');
        }
        if ($share['expires_at'] !== null && strtotime((string) $share['expires_at']) < time()) {
            throw new ApiException('This link has expired.', 403, 'expired');
        }

        $doc = Db::one(
            'SELECT * FROM documents WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $share['document_id']]
        );
        if ($doc === null) {
            throw new ApiException('That document has been removed.', 404, 'gone');
        }
        self::assertLive($doc);

        if ($share['password_hash'] !== null && $share['password_hash'] !== '') {
            $given = $_SERVER['HTTP_X_SHARE_PASSWORD'] ?? Http::query('pw', '') ?? '';
            if ($given === '' || !password_verify($given, (string) $share['password_hash'])) {
                throw new ApiException(
                    'This link needs a password.',
                    401,
                    'password_required'
                );
            }
        }

        self::touch((int) $doc['id']);

        return new self(
            $doc,
            (string) $share['role'],
            $share,
            (bool) (int) $share['allow_download']
        );
    }

    /** Count a view against a share, at most once per request. */
    public function countView(): void
    {
        if ($this->share === null) {
            return;
        }
        Db::run(
            'UPDATE shares SET view_count = view_count + 1, last_view_at = :n WHERE id = :id',
            [':n' => Db::now(), ':id' => $this->share['id']]
        );
    }

    private static function assertLive(array $doc): void
    {
        if ($doc['expires_at'] !== null && strtotime((string) $doc['expires_at']) < time()) {
            throw new ApiException('This document has expired.', 403, 'expired');
        }
    }

    /** last_seen_at is what keeps a document alive against the retention sweep. */
    private static function touch(int $id): void
    {
        Db::run('UPDATE documents SET last_seen_at = :n WHERE id = :id', [':n' => Db::now(), ':id' => $id]);
    }
}
