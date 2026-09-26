<?php
declare(strict_types=1);

namespace AddDots;

/**
 * Request reading and response writing.
 *
 * The API is token-authenticated and sets no cookies, which is what makes it
 * immune to CSRF: a browser will not attach anything useful to a cross-site
 * request, so there is nothing for a hostile page to ride on.
 */
final class Http
{
    /** @var array<string, mixed>|null */
    private static ?array $body = null;

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** The path under /api, e.g. "documents/abc/comments". */
    public static function path(): string
    {
        $uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')), '/');
        if ($base !== '' && str_starts_with($uri, $base)) {
            $uri = substr($uri, strlen($base));
        }
        return trim(rawurldecode($uri), '/');
    }

    /** @return array<string, mixed> */
    public static function json(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }
        $raw = file_get_contents('php://input') ?: '';
        if ($raw === '') {
            return self::$body = [];
        }
        $parsed = json_decode($raw, true);
        if (!is_array($parsed)) {
            throw new ApiException('The request body was not valid JSON.', 400, 'bad_json');
        }
        return self::$body = $parsed;
    }

    public static function query(string $key, ?string $fallback = null): ?string
    {
        $v = $_GET[$key] ?? null;
        return is_string($v) ? $v : $fallback;
    }

    /**
     * The bearer token, from the Authorization header or, as a fallback, the
     * query string — a plain <img>/<iframe> cannot set headers, and the file
     * endpoint has to work from a src attribute.
     */
    public static function bearer(): ?string
    {
        $h = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';
        if ($h === '' && function_exists('apache_request_headers')) {
            $all = apache_request_headers() ?: [];
            foreach ($all as $k => $v) {
                if (strcasecmp($k, 'Authorization') === 0) { $h = (string) $v; break; }
            }
        }
        if (preg_match('/^Bearer\s+(\S+)$/i', trim($h), $m) === 1) {
            return $m[1];
        }
        $q = self::query('token');
        return ($q !== null && $q !== '') ? $q : null;
    }

    public static function clientIp(): string
    {
        // Hostinger sits behind its own proxy, so the forwarded header is the
        // real caller. Only the first hop is trusted; the rest can be forged.
        $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if ($fwd !== '') {
            $first = trim(explode(',', $fwd)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                return $first;
            }
        }
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public static function cors(): void
    {
        $allowed = (array) Config::get('cors_origins', []);
        $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && in_array($origin, $allowed, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Share-Password, X-Author-Key');
            header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
            header('Access-Control-Max-Age: 600');
        }
    }

    public static function send(mixed $payload, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
        exit;
    }

    public static function fail(ApiException $e): never
    {
        if ($e->detail !== '') {
            error_log('[adddots-pdf] ' . $e->errorCode . ': ' . $e->detail);
        }
        $out = ['error' => $e->errorCode, 'message' => $e->getMessage()];
        if (Config::debug() && $e->detail !== '') {
            $out['detail'] = $e->detail;
        }
        self::send($out, $e->status);
    }

    public static function noContent(): never
    {
        http_response_code(204);
        exit;
    }

    /** Read a required string field, trimmed and length-checked. */
    public static function str(array $src, string $key, int $max, bool $required = true, string $default = ''): string
    {
        $v = $src[$key] ?? null;
        if (!is_string($v) || trim($v) === '') {
            if ($required) {
                throw new ApiException(ucfirst($key) . ' is required.', 422, 'missing_field');
            }
            return $default;
        }
        $v = trim($v);
        if (mb_strlen($v) > $max) {
            $v = mb_substr($v, 0, $max);
        }
        return $v;
    }
}
