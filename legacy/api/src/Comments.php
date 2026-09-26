<?php
declare(strict_types=1);

namespace AddDots;

/**
 * Review comments.
 *
 * A comment carries its own anchor geometry, so a reviewer never writes to the
 * owner's document state. Two people can comment on the same page at the same
 * moment without either of them losing anything.
 */
final class Comments
{
    /**
     * GET /api/documents/{id}/comments?since=<iso>
     *
     * `since` is what makes polling cheap: the client asks only for what has
     * changed, and deletions come back as tombstones so it knows to drop them.
     */
    public static function index(string $publicId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);

        $since = Http::query('since');
        $args  = [':d' => $a->documentId()];
        $where = 'document_id = :d';   // prefixed with the c. alias below

        if ($since !== null && $since !== '') {
            $ts = strtotime($since);
            if ($ts === false) {
                throw new ApiException('That "since" value is not a date.', 422, 'bad_since');
            }
            $where .= ' AND c.updated_at > :since';
            $args[':since'] = gmdate('Y-m-d H:i:s', $ts);
        } else {
            // A first load should not carry every comment ever deleted.
            $where .= ' AND c.deleted_at IS NULL';
        }

        // Self-join for the parent's public id: looking it up per row turned
        // one poll into hundreds of queries once a thread got going.
        $rows = Db::all(
            "SELECT c.*, p.public_id AS parent_public_id
               FROM comments c
               LEFT JOIN comments p ON p.id = c.parent_id
              WHERE c.$where
              ORDER BY c.created_at ASC
              LIMIT 2000",
            $args
        );

        Http::send([
            'comments' => array_map([self::class, 'shape'], $rows),
            'server_time' => Db::now(),
            'role' => $a->role,
        ]);
    }

    /** POST /api/documents/{id}/comments */
    public static function create(string $publicId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);
        $a->require(Access::COMMENT);
        RateLimit::check('comment', 60, 60, self::authorKey($a));

        $body = Http::json();

        $kind = strtolower(Http::str($body, 'kind', 10, false, 'note'));
        if (!in_array($kind, ['markup', 'note', 'reply'], true)) {
            throw new ApiException('Unknown comment kind.', 422, 'bad_kind');
        }

        $parentId = null;
        if (!empty($body['parent_id'])) {
            $parent = Db::one(
                'SELECT id FROM comments
                  WHERE public_id = :p AND document_id = :d AND deleted_at IS NULL
                  LIMIT 1',
                [':p' => (string) $body['parent_id'], ':d' => $a->documentId()]
            );
            if ($parent === null) {
                throw new ApiException('That comment no longer exists.', 404, 'no_parent');
            }
            $parentId = (int) $parent['id'];
            $kind = 'reply';
        }

        $text = Http::str($body, 'body', 5000, $kind === 'reply');
        if ($kind !== 'reply' && $text === '' && empty($body['anchor'])) {
            throw new ApiException('A comment needs either text or a mark.', 422, 'empty_comment');
        }

        $anchor = null;
        if (isset($body['anchor']) && is_array($body['anchor'])) {
            $anchor = json_encode($body['anchor'], JSON_UNESCAPED_SLASHES);
            if ($anchor !== false && strlen($anchor) > 20000) {
                throw new ApiException('That mark is too complex to store.', 413, 'anchor_too_large');
            }
        }

        $publicCommentId = Tokens::publicId();
        $now = Db::now();

        Db::insert(
            'INSERT INTO comments
               (public_id, document_id, share_id, parent_id, page_index, kind,
                anchor_json, quote, body, author_name, author_key, colour,
                created_at, updated_at)
             VALUES
               (:pid, :d, :s, :par, :pg, :k, :an, :q, :b, :name, :akey, :col, :n, :n2)',
            [
                ':pid'  => $publicCommentId,
                ':d'    => $a->documentId(),
                ':s'    => $a->shareId(),
                ':par'  => $parentId,
                ':pg'   => max(0, min(65535, (int) ($body['page_index'] ?? 0))),
                ':k'    => $kind,
                ':an'   => $anchor ?: null,
                ':q'    => Http::str($body, 'quote', 500, false),
                ':b'    => $text,
                ':name' => Http::str($body, 'author_name', 80, false, $a->isOwner() ? 'Owner' : 'Guest'),
                ':akey' => self::authorKey($a),
                ':col'  => self::colour($body['colour'] ?? null),
                ':n'    => $now,
                ':n2'   => $now,
            ]
        );

        Db::run(
            'UPDATE documents SET updated_at = :n WHERE id = :d',
            [':n' => $now, ':d' => $a->documentId()]
        );

        Http::send(['comment' => self::shapedByPublicId($publicCommentId)], 201);
    }

    /**
     * PATCH /api/documents/{id}/comments/{commentId}
     *
     * Editing text is for whoever wrote it — proved by the author key their
     * browser holds. Resolving is a document-level act, so the owner and
     * anyone with edit can do it on any comment.
     */
    public static function update(string $publicId, string $commentId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);
        $a->require(Access::COMMENT);

        $row = self::find($a, $commentId);
        $body = Http::json();
        $mine = hash_equals((string) $row['author_key'], self::authorKey($a));
        $boss = $a->isOwner() || $a->role === Access::EDIT;

        $sets = [];
        $args = [':id' => $row['id'], ':d' => $a->documentId(), ':n' => Db::now()];

        if (array_key_exists('body', $body)) {
            if (!$mine && !$boss) {
                throw new ApiException('You can only edit your own comments.', 403, 'not_yours');
            }
            $sets[] = 'body = :b';
            $args[':b'] = Http::str($body, 'body', 5000, false);
        }
        if (array_key_exists('resolved', $body)) {
            if (!$boss && !$mine) {
                throw new ApiException('Only the owner can resolve this.', 403, 'not_allowed');
            }
            $sets[] = 'resolved_at = :rv';
            $args[':rv'] = !empty($body['resolved']) ? Db::now() : null;
        }
        if ($sets === []) {
            throw new ApiException('Nothing to change.', 422, 'no_changes');
        }

        $sets[] = 'updated_at = :n';
        Db::run(
            'UPDATE comments SET ' . implode(', ', $sets) . ' WHERE id = :id AND document_id = :d',
            $args
        );

        Http::send(['comment' => self::shapedById((int) $row['id'])]);
    }

    /** DELETE /api/documents/{id}/comments/{commentId} */
    public static function destroy(string $publicId, string $commentId): never
    {
        $a = Access::resolve();
        self::assertSame($a, $publicId);
        $a->require(Access::COMMENT);

        $row  = self::find($a, $commentId);
        $mine = hash_equals((string) $row['author_key'], self::authorKey($a));
        if (!$mine && !$a->isOwner() && $a->role !== Access::EDIT) {
            throw new ApiException('You can only delete your own comments.', 403, 'not_yours');
        }

        // Soft delete, so a client polling with ?since= learns it went.
        Db::run(
            'UPDATE comments SET deleted_at = :n, updated_at = :n2, body = "" WHERE id = :id',
            [':n' => Db::now(), ':n2' => Db::now(), ':id' => $row['id']]
        );
        Db::run(
            'UPDATE comments SET deleted_at = :n, updated_at = :n2 WHERE parent_id = :id',
            [':n' => Db::now(), ':n2' => Db::now(), ':id' => $row['id']]
        );

        Http::noContent();
    }

    /** @return array<string, mixed> */
    private static function find(Access $a, string $commentId): array
    {
        $row = Db::one(
            'SELECT * FROM comments
              WHERE public_id = :p AND document_id = :d AND deleted_at IS NULL
              LIMIT 1',
            [':p' => $commentId, ':d' => $a->documentId()]
        );
        if ($row === null) {
            throw new ApiException('That comment no longer exists.', 404, 'no_comment');
        }
        return $row;
    }

    /**
     * Who is writing, for "can I edit this?".
     *
     * The owner is their document. A guest is their share link plus the key
     * their browser generated, so two people on the same link stay distinct
     * and neither can edit the other's remarks.
     */
    private static function authorKey(Access $a): string
    {
        if ($a->isOwner()) {
            return hash('sha256', 'owner:' . $a->documentId());
        }
        $given = $_SERVER['HTTP_X_AUTHOR_KEY'] ?? '';
        $given = is_string($given) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', $given) ?? '', 0, 64) : '';
        return hash('sha256', 'share:' . (string) $a->shareId() . ':' . $given);
    }

    /**
     * Fetch one comment with the same shape the listing produces.
     *
     * shape() reads parent_public_id, which only exists because of the
     * self-join. Re-using it here keeps a reply's parent from coming back
     * null the moment it is created.
     *
     * @return array<string, mixed>
     */
    private static function shapedBy(string $column, int|string $value): array
    {
        $row = Db::one(
            "SELECT c.*, p.public_id AS parent_public_id
               FROM comments c
               LEFT JOIN comments p ON p.id = c.parent_id
              WHERE c.$column = :v
              LIMIT 1",
            [':v' => $value]
        );
        return self::shape($row ?? []);
    }

    /** @return array<string, mixed> */
    private static function shapedByPublicId(string $publicId): array
    {
        return self::shapedBy('public_id', $publicId);
    }

    /** @return array<string, mixed> */
    private static function shapedById(int $id): array
    {
        return self::shapedBy('id', $id);
    }

    /**
     * The token already identifies the document; the id in the path is
     * confirmation. A mismatch means the caller is aiming at the wrong thing.
     */
    private static function assertSame(Access $a, string $publicId): void
    {
        if (!hash_equals((string) $a->document['public_id'], $publicId)) {
            throw new ApiException('This link is not valid for that document.', 403, 'wrong_document');
        }
    }

    private static function colour(mixed $c): string
    {
        return (is_string($c) && preg_match('/^#[0-9A-Fa-f]{6}$/', $c) === 1) ? $c : '#F2C14E';
    }

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function shape(array $r): array
    {
        if ($r === []) {
            return [];
        }
        return [
            'id'          => $r['public_id'],
            'parent_id'   => $r['parent_public_id'] ?? null,
            'page_index'  => (int) $r['page_index'],
            'kind'        => $r['kind'],
            'anchor'      => $r['anchor_json'] !== null ? json_decode((string) $r['anchor_json'], true) : null,
            'quote'       => $r['quote'],
            'body'        => $r['body'],
            'author_name' => $r['author_name'],
            'colour'      => $r['colour'],
            'resolved'    => $r['resolved_at'] !== null,
            'deleted'     => $r['deleted_at'] !== null,
            'created_at'  => $r['created_at'],
            'updated_at'  => $r['updated_at'],
        ];
    }

}
