<?php
declare(strict_types=1);

namespace AddDots;

final class Config
{
    /** @var array<string, mixed>|null */
    private static ?array $data = null;

    public static function boot(string $file): void
    {
        if (!is_file($file)) {
            throw new ApiException(
                'The API is not configured yet. Copy api/config.example.php to '
                . 'api/config.php and fill in your database details.',
                503,
                'not_configured'
            );
        }
        /** @var array<string, mixed> $cfg */
        $cfg = require $file;
        self::$data = $cfg;
    }

    public static function get(string $key, mixed $fallback = null): mixed
    {
        return self::$data[$key] ?? $fallback;
    }

    public static function debug(): bool
    {
        return (bool) self::get('debug', false);
    }
}
