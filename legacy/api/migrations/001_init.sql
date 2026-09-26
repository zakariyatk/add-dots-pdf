-- ADD DOTS PDF — collaboration schema
--
-- There are no user accounts. Access is by secret token, which is what lets a
-- reviewer open a link and comment without signing up for anything. Tokens are
-- stored only as SHA-256 hashes, so a copy of this database does not let anyone
-- into a single document.
--
-- utf8mb4 throughout: comments carry whatever people actually type, emoji and
-- non-Latin scripts included.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `documents` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id`       CHAR(22)        NOT NULL,        -- url-safe, non-sequential
  `owner_hash`      CHAR(64)        NOT NULL,        -- sha256 of the owner token
  `title`           VARCHAR(255)    NOT NULL DEFAULT '',
  `filename`        VARCHAR(255)    NOT NULL DEFAULT 'document.pdf',
  `byte_size`       INT UNSIGNED    NOT NULL DEFAULT 0,
  `page_count`      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `storage_key`     VARCHAR(140)    NOT NULL,        -- path under the store root
  `sha256`          CHAR(64)        NOT NULL DEFAULT '',
  `state_json`      MEDIUMTEXT      NULL,            -- the owner's marks
  `state_version`   INT UNSIGNED    NOT NULL DEFAULT 0,
  `created_at`      DATETIME        NOT NULL,
  `updated_at`      DATETIME        NOT NULL,
  `last_seen_at`    DATETIME        NULL,            -- drives housekeeping
  `expires_at`      DATETIME        NULL,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_documents_public` (`public_id`),
  KEY `ix_documents_owner` (`owner_hash`),
  KEY `ix_documents_sweep` (`deleted_at`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- shares — one row per link handed out
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shares` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `document_id`     BIGINT UNSIGNED NOT NULL,
  `token_hash`      CHAR(64)        NOT NULL,
  `label`           VARCHAR(120)    NOT NULL DEFAULT '',   -- "Sent to the architect"
  `role`            ENUM('view','comment','edit') NOT NULL DEFAULT 'comment',
  `password_hash`   VARCHAR(255)    NULL,                  -- optional, bcrypt
  `allow_download`  TINYINT(1)      NOT NULL DEFAULT 1,
  `expires_at`      DATETIME        NULL,
  `revoked_at`      DATETIME        NULL,
  `view_count`      INT UNSIGNED    NOT NULL DEFAULT 0,
  `last_view_at`    DATETIME        NULL,
  `created_at`      DATETIME        NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_shares_token` (`token_hash`),
  KEY `ix_shares_doc` (`document_id`),
  CONSTRAINT `fk_shares_doc` FOREIGN KEY (`document_id`)
    REFERENCES `documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- comments
--
-- A review mark carries its own geometry in `anchor_json` rather than being
-- written into the document state. That keeps reviewers off the owner's copy
-- entirely: two people commenting at once cannot overwrite each other, and
-- nothing a reviewer does can corrupt the document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `comments` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id`       CHAR(22)        NOT NULL,
  `document_id`     BIGINT UNSIGNED NOT NULL,
  `share_id`        BIGINT UNSIGNED NULL,             -- null when the owner wrote it
  `parent_id`       BIGINT UNSIGNED NULL,             -- set on a reply
  `page_index`      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `kind`            ENUM('markup','note','reply') NOT NULL DEFAULT 'note',
  `anchor_json`     TEXT            NULL,             -- quads or a point, PDF points
  `quote`           VARCHAR(500)    NOT NULL DEFAULT '',
  `body`            TEXT            NOT NULL,
  `author_name`     VARCHAR(80)     NOT NULL DEFAULT 'Guest',
  `author_key`      CHAR(64)        NOT NULL DEFAULT '', -- lets a guest edit their own
  `colour`          CHAR(7)         NOT NULL DEFAULT '#F2C14E',
  `resolved_at`     DATETIME        NULL,
  `created_at`      DATETIME        NOT NULL,
  `updated_at`      DATETIME        NOT NULL,
  `deleted_at`      DATETIME        NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comments_public` (`public_id`),
  KEY `ix_comments_doc` (`document_id`, `updated_at`),
  KEY `ix_comments_parent` (`parent_id`),
  CONSTRAINT `fk_comments_doc` FOREIGN KEY (`document_id`)
    REFERENCES `documents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_comments_share` FOREIGN KEY (`share_id`)
    REFERENCES `shares` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- rate_limits — a fixed window per caller per action
--
-- Shared hosting has no Redis, so this lives in MySQL. The table stays small
-- because expired windows are swept on write.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `rate_limits` (
  `bucket`          VARCHAR(160)    NOT NULL,
  `window_start`    INT UNSIGNED    NOT NULL,
  `hits`            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`bucket`),
  KEY `ix_rate_window` (`window_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
