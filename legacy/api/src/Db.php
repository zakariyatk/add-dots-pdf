<?php
declare(strict_types=1);

namespace AddDots;

use PDO;
use PDOException;

/**
 * A thin wrapper over one PDO handle.
 *
 * Everything is a prepared statement — there is no string-built SQL anywhere in
 * this codebase, so nothing a reviewer types can reach the parser.
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $cfg = Config::get('db');
        $dsn = sprintf('mysql:host=%s;', $cfg['host']);
        if (!empty($cfg['port'])) {
            $dsn .= sprintf('port=%d;', (int) $cfg['port']);
        }
        $dsn .= sprintf('dbname=%s;charset=%s', $cfg['name'], $cfg['charset'] ?? 'utf8mb4');

        try {
            self::$pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Real prepared statements, not emulated ones, so the values
                // never get interpolated into the query text at all.
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_STRINGIFY_FETCHES  => false,
            ]);
        } catch (PDOException $e) {
            throw new ApiException(
                'The database is unavailable.',
                503,
                'db_unavailable',
                $e->getMessage()
            );
        }

        return self::$pdo;
    }

    /** @param array<string|int, mixed> $args */
    public static function run(string $sql, array $args = []): \PDOStatement
    {
        $st = self::conn()->prepare($sql);
        $st->execute($args);
        return $st;
    }

    /**
     * @param array<string|int, mixed> $args
     * @return array<string, mixed>|null
     */
    public static function one(string $sql, array $args = []): ?array
    {
        $row = self::run($sql, $args)->fetch();
        return $row === false ? null : $row;
    }

    /**
     * @param array<string|int, mixed> $args
     * @return list<array<string, mixed>>
     */
    public static function all(string $sql, array $args = []): array
    {
        return self::run($sql, $args)->fetchAll();
    }

    public static function insert(string $sql, array $args = []): int
    {
        self::run($sql, $args);
        return (int) self::conn()->lastInsertId();
    }

    public static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }
}
