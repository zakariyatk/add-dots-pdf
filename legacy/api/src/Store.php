<?php
declare(strict_types=1);

namespace AddDots;

/**
 * Where the PDF bytes live.
 *
 * Files are written outside the web root and served only by streamFile(), after
 * the caller's token has been checked. Nothing here is reachable by URL, so a
 * leaked or guessed filename gets nobody anywhere.
 */
final class Store
{
    public static function root(): string
    {
        $root = (string) Config::get('storage_path');
        if ($root === '') {
            throw new ApiException('Storage is not configured.', 503, 'no_storage');
        }
        if (!is_dir($root) && !@mkdir($root, 0750, true) && !is_dir($root)) {
            throw new ApiException(
                'The storage folder could not be created. Check the path and its permissions.',
                503,
                'storage_unwritable',
                $root
            );
        }
        // Belt and braces: if the path does end up inside public_html on some
        // setup, this stops the web server serving anything out of it.
        $guard = $root . '/.htaccess';
        if (!is_file($guard)) {
            @file_put_contents($guard, "Require all denied\nDeny from all\n");
        }
        return rtrim($root, '/\\');
    }

    /** Shard by the first two characters so no directory gets huge. */
    public static function keyFor(string $publicId): string
    {
        $safe = preg_replace('/[^A-Za-z0-9_-]/', '', $publicId) ?? '';
        if (strlen($safe) < 8) {
            throw new ApiException('Bad storage key.', 500, 'bad_key');
        }
        return substr($safe, 0, 2) . '/' . $safe . '.pdf';
    }

    private static function absolute(string $key): string
    {
        // The key is built by us, never taken from the request, but check it
        // anyway — a traversal here would be a file-read of the whole account.
        if (str_contains($key, '..') || str_contains($key, "\0")) {
            throw new ApiException('Bad storage key.', 400, 'bad_key');
        }
        return self::root() . '/' . $key;
    }

    public static function write(string $key, string $bytes): void
    {
        $path = self::absolute($key);
        $dir  = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new ApiException('Could not create the storage folder.', 503, 'storage_unwritable', $dir);
        }
        // Write beside the target and rename, so a failed or half-finished
        // upload can never replace a good file with a truncated one.
        $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.part';
        if (@file_put_contents($tmp, $bytes, LOCK_EX) === false) {
            throw new ApiException('Could not save the file.', 503, 'storage_write_failed', $path);
        }
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            throw new ApiException('Could not save the file.', 503, 'storage_rename_failed', $path);
        }
        @chmod($path, 0640);
    }

    public static function exists(string $key): bool
    {
        return is_file(self::absolute($key));
    }

    public static function delete(string $key): void
    {
        $path = self::absolute($key);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    /** Stream a stored PDF to the client, with range support so viewers can seek. */
    public static function streamFile(string $key, string $filename, bool $asDownload): never
    {
        $path = self::absolute($key);
        if (!is_file($path)) {
            throw new ApiException('That file is no longer on the server.', 404, 'file_missing');
        }
        $size = (int) filesize($path);
        $fh   = @fopen($path, 'rb');
        if ($fh === false) {
            throw new ApiException('That file could not be read.', 503, 'file_unreadable');
        }

        // Strip anything that could break out of the header or inject a path.
        $safeName = preg_replace('/[^A-Za-z0-9 ._-]/', '_', $filename) ?: 'document.pdf';

        $start = 0;
        $end   = $size - 1;
        $range = $_SERVER['HTTP_RANGE'] ?? '';
        $partial = false;
        if ($range !== '' && preg_match('/bytes=(\d*)-(\d*)/', $range, $m) === 1) {
            $s = $m[1] === '' ? null : (int) $m[1];
            $e = $m[2] === '' ? null : (int) $m[2];
            if ($s === null && $e !== null) {          // suffix range: last N bytes
                $start = max(0, $size - $e);
            } elseif ($s !== null) {
                $start = $s;
                if ($e !== null) { $end = min($e, $size - 1); }
            }
            if ($start > $end || $start >= $size) {
                header('Content-Range: bytes */' . $size);
                fclose($fh);
                throw new ApiException('That byte range is outside the file.', 416, 'bad_range');
            }
            $partial = true;
        }

        $length = $end - $start + 1;
        http_response_code($partial ? 206 : 200);
        header('Content-Type: application/pdf');
        header('Content-Length: ' . $length);
        header('Accept-Ranges: bytes');
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        // A stored PDF is untrusted input. Telling the browser to download it
        // rather than render it inline keeps any script inside it inert.
        header(sprintf(
            '%s; filename="%s"',
            $asDownload ? 'Content-Disposition: attachment' : 'Content-Disposition: inline',
            $safeName
        ));
        if ($partial) {
            header(sprintf('Content-Range: bytes %d-%d/%d', $start, $end, $size));
        }

        // Drop any buffering so a big file does not have to fit in memory.
        while (ob_get_level() > 0) { ob_end_clean(); }
        fseek($fh, $start);
        $remaining = $length;
        while ($remaining > 0 && !feof($fh)) {
            $chunk = fread($fh, (int) min(262144, $remaining));
            if ($chunk === false) { break; }
            echo $chunk;
            $remaining -= strlen($chunk);
            flush();
        }
        fclose($fh);
        exit;
    }

    /**
     * Confirm the bytes really are a PDF before we keep them.
     * The magic number is allowed a little slack because some producers put
     * junk in front of it, which Acrobat tolerates.
     */
    public static function looksLikePdf(string $bytes): bool
    {
        $head = substr($bytes, 0, 1024);
        return str_contains($head, '%PDF-');
    }
}
