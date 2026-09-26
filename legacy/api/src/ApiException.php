<?php
declare(strict_types=1);

namespace AddDots;

/**
 * Anything thrown as one of these is a fault we chose to report. The message is
 * written for the person using the app, `detail` is for the server log only and
 * never reaches the client unless debug is on.
 */
final class ApiException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 400,
        /* Not named $code: Exception already owns that property, and PHP will
           not let a subclass redeclare it as readonly. */
        public readonly string $errorCode = 'bad_request',
        public readonly string $detail = ''
    ) {
        parent::__construct($message, $status);
    }
}
