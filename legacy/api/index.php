<?php
declare(strict_types=1);

/**
 * Add Dots PDF — API front controller.
 *
 * Every request under /api lands here. Routing is a short explicit table
 * rather than a framework: on shared hosting the whole point is that this
 * drops into public_html and runs with no composer install and no build step.
 */

namespace AddDots;

// PHP's own errors go to the log, never to the client — an error page that
// leaks a file path or a query is a gift to anyone probing the server.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'AddDots\\')) {
        return;
    }
    $file = __DIR__ . '/src/' . substr($class, 8) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

require_once __DIR__ . '/src/ApiException.php';

try {
    Config::boot(__DIR__ . '/config.php');
    Http::cors();

    if (Http::method() === 'OPTIONS') {
        http_response_code(204);
        exit;
    }

    $path   = Http::path();
    $method = Http::method();
    $parts  = $path === '' ? [] : explode('/', $path);

    // A tunnelled method, because some shared-hosting setups and proxies still
    // drop PATCH and DELETE on the floor.
    $override = $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '';
    if ($method === 'POST' && in_array(strtoupper($override), ['PUT', 'PATCH', 'DELETE'], true)) {
        $method = strtoupper($override);
    }

    // ---- routes -----------------------------------------------------------
    //  GET    health
    //  POST   documents
    //  GET    documents/{id}
    //  DELETE documents/{id}
    //  GET    documents/{id}/file
    //  PUT    documents/{id}/state
    //  GET    documents/{id}/shares
    //  POST   documents/{id}/shares
    //  PATCH  documents/{id}/shares/{shareId}
    //  DELETE documents/{id}/shares/{shareId}
    //  GET    documents/{id}/comments
    //  POST   documents/{id}/comments
    //  PATCH  documents/{id}/comments/{commentId}
    //  DELETE documents/{id}/comments/{commentId}

    if ($parts === ['health'] && $method === 'GET') {
        Http::send([
            'ok'         => true,
            'php'        => PHP_VERSION,
            'time'       => Db::now(),
            'max_upload' => (int) Config::get('max_upload_bytes'),
        ]);
    }

    // A share link carries only its token — no document id — so the client
    // asks the server what that token opens before it can call anything else.
    if ($parts === ['resolve'] && $method === 'GET') {
        Documents::resolve();
    }

    if ($parts === ['documents'] && $method === 'POST') {
        Documents::create();
    }

    if (count($parts) >= 2 && $parts[0] === 'documents') {
        $id = idOrFail($parts[1] ?? '');
        $tail = array_slice($parts, 2);

        if ($tail === []) {
            if ($method === 'GET')    { Documents::show($id); }
            if ($method === 'DELETE') { Documents::destroy($id); }
        }

        if ($tail === ['file'] && $method === 'GET') {
            Documents::file($id);
        }

        if ($tail === ['state'] && ($method === 'PUT' || $method === 'POST')) {
            Documents::saveState($id);
        }

        if ($tail === ['shares']) {
            if ($method === 'GET')  { Shares::index($id); }
            if ($method === 'POST') { Shares::create($id); }
        }

        if (count($tail) === 2 && $tail[0] === 'shares') {
            if ($method === 'PATCH')  { Shares::update($id, $tail[1]); }
            if ($method === 'DELETE') { Shares::destroy($id, $tail[1]); }
        }

        if ($tail === ['comments']) {
            if ($method === 'GET')  { Comments::index($id); }
            if ($method === 'POST') { Comments::create($id); }
        }

        if (count($tail) === 2 && $tail[0] === 'comments') {
            if ($method === 'PATCH')  { Comments::update($id, $tail[1]); }
            if ($method === 'DELETE') { Comments::destroy($id, $tail[1]); }
        }
    }

    throw new ApiException('No such endpoint.', 404, 'not_found');
} catch (ApiException $e) {
    Http::fail($e);
} catch (\Throwable $e) {
    // Anything unplanned: log the detail, tell the client nothing useful.
    error_log('[adddots-pdf] uncaught: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::fail(new ApiException(
        'Something went wrong on the server.',
        500,
        'server_error',
        $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine()
    ));
}

/** Guard the id shape before it reaches a query or a filename. */
function idOrFail(string $raw): string
{
    if (preg_match('/^[A-Za-z0-9_-]{8,32}$/', $raw) !== 1) {
        throw new ApiException('That document id is not valid.', 400, 'bad_id');
    }
    return $raw;
}
