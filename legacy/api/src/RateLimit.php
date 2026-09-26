<?php
declare(strict_types=1);

namespace AddDots;

/**
 * A fixed-window limiter kept in MySQL, because shared hosting has no Redis.
 *
 * The bucket is hashed so that neither an IP address nor a secret token is
 * stored in the clear, and expired windows are swept on the way past so the
 * table cannot grow without bound.
 */
final class RateLimit
{
    public static function check(string $action, int $limit, int $windowSeconds = 60, string $subject = ''): void
    {
        $subject = $subject !== '' ? $subject : Http::clientIp();
        $bucket  = hash('sha256', $action . '|' . $subject);
        $start   = intdiv(time(), $windowSeconds) * $windowSeconds;

        // One statement, so two requests arriving together cannot both read a
        // stale count and both decide they are under the limit.
        Db::run(
            'INSERT INTO rate_limits (bucket, window_start, hits)
             VALUES (:b, :w, 1)
             ON DUPLICATE KEY UPDATE
               hits         = IF(window_start = VALUES(window_start), hits + 1, 1),
               window_start = VALUES(window_start)',
            [':b' => $bucket, ':w' => $start]
        );

        $row  = Db::one('SELECT hits FROM rate_limits WHERE bucket = :b', [':b' => $bucket]);
        $hits = (int) ($row['hits'] ?? 0);

        if (random_int(1, 50) === 1) {
            Db::run('DELETE FROM rate_limits WHERE window_start < :cut', [':cut' => $start - 3600]);
        }

        if ($hits > $limit) {
            header('Retry-After: ' . ($start + $windowSeconds - time()));
            throw new ApiException(
                'That is a lot of requests in a short time. Wait a moment and try again.',
                429,
                'rate_limited'
            );
        }
    }
}
