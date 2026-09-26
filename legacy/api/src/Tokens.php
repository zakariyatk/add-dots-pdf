<?php
declare(strict_types=1);

namespace AddDots;

/**
 * Secret links, and the ids that appear in them.
 *
 * A token is 32 random bytes shown base64url — 256 bits, so guessing one is not
 * a threat model. Only the SHA-256 of it is ever stored, which means a dump of
 * the database does not open a single document. SHA-256 rather than bcrypt is
 * deliberate here: the input is full-entropy random, so there is nothing to
 * brute force, and every request has to hash it.
 */
final class Tokens
{
    public static function secret(): string
    {
        return self::b64(random_bytes(32));
    }

    /** A short, non-sequential public id for a row. */
    public static function publicId(): string
    {
        return substr(self::b64(random_bytes(16)), 0, 22);
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /** Constant-time compare, so a reply cannot be timed byte by byte. */
    public static function matches(string $token, string $storedHash): bool
    {
        return hash_equals($storedHash, self::hash($token));
    }

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
