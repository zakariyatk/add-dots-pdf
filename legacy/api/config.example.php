<?php
/**
 * Copy this file to config.php and fill it in. config.php is the only file
 * with secrets in it, and it must never be committed or served.
 *
 * In Hostinger hPanel the database details are under Databases -> Management.
 */
return [
    'db' => [
        'host'     => 'localhost',
        // Only if your host uses a non-standard MySQL port; omit otherwise.
        // 'port'  => 3306,
        'name'     => 'uXXXXXXX_pdfreader',
        'user'     => 'uXXXXXXX_pdf',
        'pass'     => '',
        'charset'  => 'utf8mb4',
    ],

    /**
     * Where the uploaded PDFs live.
     *
     * Keep this OUTSIDE public_html so a guessed URL can never reach a file —
     * every download goes through the API, which checks the token first.
     * The default climbs one level out of the web root, which is what a stock
     * Hostinger account gives you.
     */
    'storage_path' => dirname(__DIR__, 2) . '/pdfreader-storage',

    /**
     * Hard ceiling on an upload, in bytes. Keep this at or below the smaller of
     * upload_max_filesize and post_max_size in hPanel -> PHP Configuration,
     * or the browser will get a truncated request with no useful error.
     */
    'max_upload_bytes' => 48 * 1024 * 1024,

    /** A document nobody has opened for this many days is swept away. */
    'retention_days' => 180,

    /** Other origins allowed to use this API. The browser app on this same
     *  site needs none. The Windows and phone apps share through this server
     *  (shareServer in js/config.js), from these origins:
     *    'http://tauri.localhost'  Windows app
     *    'https://localhost'       Android app
     *    'capacitor://localhost'   iOS app
     *  Use [] to allow this site only. */
    'cors_origins' => ['http://tauri.localhost', 'https://localhost', 'capacitor://localhost'],

    /** Set false once you are live: it stops error details reaching the client. */
    'debug' => false,
];
