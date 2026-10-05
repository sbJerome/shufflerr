import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMigration1791192875557 implements MigrationInterface {
  name = 'InitialMigration1791192875557';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "title" varchar, "mbid" varchar NOT NULL, "blocklistedTags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "mediaId" integer, CONSTRAINT "UQ_9d36a1ac9a412ba6f36c60a6897" UNIQUE ("mbid", "mediaType"), CONSTRAINT "REL_5c8af2d0e83b3be6d250eccc19" UNIQUE ("mediaId"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_526a98c8311a9b1b83189eb760" ON "blocklist" ("mbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "issue_comment" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "message" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "issueId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_707b033c2d0653f75213614789" ON "issue_comment" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_180710fead1c94ca499c57a7d4" ON "issue_comment" ("issueId") `
    );
    await queryRunner.query(
      `CREATE TABLE "issue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "issueType" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "problemTracks" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "createdById" integer, "modifiedById" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53d04c07c3f4f54eae372ed665" ON "issue" ("issueType") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_276e20d053f3cff1645803c95d" ON "issue" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10b17b49d1ee77e7184216001e" ON "issue" ("createdById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da88a1019c850d1a7b143ca02e" ON "issue" ("modifiedById") `
    );
    await queryRunner.query(
      `CREATE TABLE "track" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "recordingMbid" varchar, "position" varchar NOT NULL, "discNumber" integer NOT NULL DEFAULT (1), "trackNumber" integer NOT NULL DEFAULT (0), "title" varchar NOT NULL, "artistCredit" varchar NOT NULL DEFAULT (''), "lengthMs" integer, "status" integer NOT NULL DEFAULT (1), "fileFormat" varchar, "sourceIds" text, "peaks" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, CONSTRAINT "UQ_track_media_position" UNIQUE ("mediaId", "position"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30e3a3e4a7ceaf5127fb35322f" ON "track" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47c7f19876b39cf3bf3db36f6b" ON "track" ("recordingMbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dcf30430ba207bf1887bd384a6" ON "track" ("status") `
    );
    await queryRunner.query(
      `CREATE TABLE "track_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestId" integer, "trackId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5" ON "track_request" ("requestId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14760a9c6609e37fe633ddd02c" ON "track_request" ("trackId") `
    );
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "scope" varchar NOT NULL, "isAutoApproved" boolean NOT NULL DEFAULT (0), "isAutoRequest" boolean NOT NULL DEFAULT (0), "ignoreQuota" boolean NOT NULL DEFAULT (0), "releaseCount" integer NOT NULL DEFAULT (0), "trackCount" integer NOT NULL DEFAULT (0), "serverId" integer, "qualityProfileId" integer, "metadataProfileId" integer, "rootFolder" varchar, "isHiRes" boolean NOT NULL DEFAULT (0), "monitorFuture" boolean NOT NULL DEFAULT (0), "downloadProgress" integer, "failureReason" varchar, "declineReason" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "requestedById" integer, "modifiedById" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a1aa713f41c99e9d10c48da75a" ON "media_request" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6997bee94720f1ecb7f3113709" ON "media_request" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f4fc4efa14c3ba2b29c4525fa1" ON "media_request" ("modifiedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_media_scope_status" ON "media_request" ("mediaId", "scope", "status") `
    );
    await queryRunner.query(
      `CREATE TABLE "media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "mbid" varchar NOT NULL, "artistMbid" varchar, "title" varchar NOT NULL DEFAULT (''), "artistName" varchar, "primaryType" varchar, "secondaryTypes" text, "firstReleaseDate" varchar, "status" integer NOT NULL DEFAULT (1), "trackCount" integer, "tracksAvailable" integer NOT NULL DEFAULT (0), "releaseMbid" varchar, "lidarrServerId" integer, "lidarrArtistId" integer, "lidarrAlbumId" integer, "lidarrAddedByShufflerr" boolean NOT NULL DEFAULT (0), "plexRatingKey" varchar, "jellyfinItemId" varchar, "navidromeId" varchar, "localPath" varchar, "lastScanAt" datetime, "mediaAddedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_media_type_mbid" UNIQUE ("mediaType", "mbid"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e2a99bfef02f8f080442ba4d2" ON "media" ("mbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fadf745b3868369182773ffd89" ON "media" ("artistMbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c730c2d67f271a372c39a07b7e" ON "media" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0d04ac96042a170a457c6f11ae" ON "media" ("mediaAddedAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "watchlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "source" varchar NOT NULL DEFAULT ('manual'), "mediaType" varchar NOT NULL, "title" varchar NOT NULL, "mbid" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestedById" integer, "mediaId" integer, CONSTRAINT "UNIQUE_USER_DB" UNIQUE ("mbid", "mediaType", "requestedById"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbb73271b5059b373cf1ea0e18" ON "watchlist" ("mbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae34e6b153a90672eb9dc4857d" ON "watchlist" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6641da8d831b93dfcb429f8b8b" ON "watchlist" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE TABLE "linked_account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" varchar NOT NULL, "externalUsername" varchar NOT NULL DEFAULT (''), "secret" text NOT NULL, "scopes" varchar, "expiresAt" datetime, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastUsedAt" datetime, "userId" integer, CONSTRAINT "UQ_linked_account_user_provider" UNIQUE ("userId", "provider"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db4c4bfb7727d438b35364fbd0" ON "linked_account" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_push_subscription" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "endpoint" varchar NOT NULL, "p256dh" varchar NOT NULL, "auth" varchar NOT NULL, "userAgent" varchar, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "UQ_6427d07d9a171a3a1ab87480005" UNIQUE ("endpoint", "userId"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03f7958328e311761b0de675fb" ON "user_push_subscription" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "discoverRegion" varchar, "pgpKey" varchar, "discordIds" text, "pushbulletAccessToken" varchar, "pushoverApplicationToken" varchar, "pushoverUserKey" varchar, "pushoverSound" varchar, "telegramChatId" varchar, "telegramMessageThreadId" varchar, "telegramSendSilently" boolean, "autoRequestSpotifySaved" boolean NOT NULL DEFAULT (0), "scrobbleEnabled" boolean NOT NULL DEFAULT (1), "notificationTypes" text, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"))`
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "email" varchar NOT NULL, "plexUsername" varchar, "jellyfinUsername" varchar, "username" varchar, "password" varchar, "resetPasswordGuid" varchar, "recoveryLinkExpirationDate" datetime, "userType" integer NOT NULL DEFAULT (1), "plexId" integer, "jellyfinUserId" varchar, "jellyfinDeviceId" varchar, "jellyfinAuthToken" varchar, "plexToken" varchar, "permissions" integer NOT NULL DEFAULT (0), "avatar" varchar NOT NULL, "avatarETag" varchar, "avatarVersion" varchar, "albumQuotaLimit" integer, "albumQuotaDays" integer, "trackQuotaLimit" integer, "trackQuotaDays" integer, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"))`
    );
    await queryRunner.query(
      `CREATE TABLE "app_password" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "hash" varchar NOT NULL, "encryptedSecret" text NOT NULL, "accessToken" varchar, "lastUsedAt" datetime, "lastUsedClient" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef734727840f2a6cd78c293378" ON "app_password" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ebca0c0b75dd511211f8a9c1f" ON "app_password" ("accessToken") `
    );
    await queryRunner.query(
      `CREATE TABLE "discover_slider" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "type" integer NOT NULL, "order" integer NOT NULL, "isBuiltIn" boolean NOT NULL DEFAULT (0), "enabled" boolean NOT NULL DEFAULT (1), "title" varchar, "data" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
    );
    await queryRunner.query(
      `CREATE TABLE "event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" varchar NOT NULL, "externalId" varchar NOT NULL, "artistMbid" varchar, "artistName" varchar NOT NULL, "name" varchar, "venue" varchar, "city" varchar, "country" varchar, "startsAt" datetime NOT NULL, "url" varchar NOT NULL, "imageUrl" varchar, "fetchedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_event_provider_external" UNIQUE ("provider", "externalId"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a4e21f37e181fc529203d258a" ON "event" ("artistMbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b966c85d9a41aeb737fea8672d" ON "event" ("country") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1642f51b7417f5ddffd32c7134" ON "event" ("startsAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "import_job" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "source" varchar NOT NULL, "url" varchar NOT NULL, "title" varchar, "status" varchar NOT NULL DEFAULT ('resolving'), "error" varchar, "matched" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5128ba16a1effbbd06740606fb" ON "import_job" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "override_rule" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "lidarrServiceId" integer, "users" varchar, "genre" varchar, "label" varchar, "primaryType" varchar, "profileId" integer, "metadataProfileId" integer, "rootFolder" varchar, "tags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
    );
    await queryRunner.query(
      `CREATE TABLE "playlist_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "position" integer NOT NULL DEFAULT (0), "playlistId" integer, "trackId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b9b229772d88966e7d9959d90" ON "playlist_item" ("playlistId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_775b9c3be0f7e2241229c8fff7" ON "playlist_item" ("trackId") `
    );
    await queryRunner.query(
      `CREATE TABLE "playlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "comment" varchar, "isPublic" boolean NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92ca9b9b5394093adb6e5f55c4" ON "playlist" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "scrobble_queue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "recordingMbid" varchar, "releaseGroupMbid" varchar, "trackId" integer, "artist" varchar NOT NULL, "track" varchar NOT NULL, "album" varchar, "durationMs" integer, "playedAt" datetime NOT NULL, "source" varchar NOT NULL, "targets" text NOT NULL, "attempts" integer NOT NULL DEFAULT (0), "lastError" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c0066088d4849e34b474acc19" ON "scrobble_queue" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8a227c0ab7e5bf83b1c0845db" ON "scrobble_queue" ("playedAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "session" ("expiredAt" bigint NOT NULL, "id" varchar(255) PRIMARY KEY NOT NULL, "json" text NOT NULL, "destroyedAt" datetime)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28c5d1d16da7908c97c9bc2f74" ON "session" ("expiredAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "star" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "trackId" integer, "mediaId" integer, CONSTRAINT "UQ_star_user_track_media" UNIQUE ("userId", "trackId", "mediaId"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2018c9deccb66c6db30a1ddbd1" ON "star" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0fe75bc5cb0c9c7369f6499c6" ON "star" ("trackId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1be6158f58d57dfcfb6507745d" ON "star" ("mediaId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_526a98c8311a9b1b83189eb760"`);
    await queryRunner.query(`DROP INDEX "IDX_356721a49f145aa439c16e6b99"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "title" varchar, "mbid" varchar NOT NULL, "blocklistedTags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "mediaId" integer, CONSTRAINT "UQ_9d36a1ac9a412ba6f36c60a6897" UNIQUE ("mbid", "mediaType"), CONSTRAINT "REL_5c8af2d0e83b3be6d250eccc19" UNIQUE ("mediaId"), CONSTRAINT "FK_356721a49f145aa439c16e6b999" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION, CONSTRAINT "FK_5c8af2d0e83b3be6d250eccc19d" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_blocklist"("id", "mediaType", "title", "mbid", "blocklistedTags", "createdAt", "userId", "mediaId") SELECT "id", "mediaType", "title", "mbid", "blocklistedTags", "createdAt", "userId", "mediaId" FROM "blocklist"`
    );
    await queryRunner.query(`DROP TABLE "blocklist"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_blocklist" RENAME TO "blocklist"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_526a98c8311a9b1b83189eb760" ON "blocklist" ("mbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_707b033c2d0653f75213614789"`);
    await queryRunner.query(`DROP INDEX "IDX_180710fead1c94ca499c57a7d4"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_issue_comment" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "message" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "issueId" integer, CONSTRAINT "FK_707b033c2d0653f75213614789d" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_180710fead1c94ca499c57a7d42" FOREIGN KEY ("issueId") REFERENCES "issue" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_issue_comment"("id", "message", "createdAt", "updatedAt", "userId", "issueId") SELECT "id", "message", "createdAt", "updatedAt", "userId", "issueId" FROM "issue_comment"`
    );
    await queryRunner.query(`DROP TABLE "issue_comment"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_issue_comment" RENAME TO "issue_comment"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_707b033c2d0653f75213614789" ON "issue_comment" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_180710fead1c94ca499c57a7d4" ON "issue_comment" ("issueId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_53d04c07c3f4f54eae372ed665"`);
    await queryRunner.query(`DROP INDEX "IDX_276e20d053f3cff1645803c95d"`);
    await queryRunner.query(`DROP INDEX "IDX_10b17b49d1ee77e7184216001e"`);
    await queryRunner.query(`DROP INDEX "IDX_da88a1019c850d1a7b143ca02e"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_issue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "issueType" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "problemTracks" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "createdById" integer, "modifiedById" integer, CONSTRAINT "FK_276e20d053f3cff1645803c95d8" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_10b17b49d1ee77e7184216001e0" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_da88a1019c850d1a7b143ca02e5" FOREIGN KEY ("modifiedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_issue"("id", "issueType", "status", "problemTracks", "createdAt", "updatedAt", "mediaId", "createdById", "modifiedById") SELECT "id", "issueType", "status", "problemTracks", "createdAt", "updatedAt", "mediaId", "createdById", "modifiedById" FROM "issue"`
    );
    await queryRunner.query(`DROP TABLE "issue"`);
    await queryRunner.query(`ALTER TABLE "temporary_issue" RENAME TO "issue"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_53d04c07c3f4f54eae372ed665" ON "issue" ("issueType") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_276e20d053f3cff1645803c95d" ON "issue" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10b17b49d1ee77e7184216001e" ON "issue" ("createdById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da88a1019c850d1a7b143ca02e" ON "issue" ("modifiedById") `
    );
    await queryRunner.query(`DROP INDEX "IDX_30e3a3e4a7ceaf5127fb35322f"`);
    await queryRunner.query(`DROP INDEX "IDX_47c7f19876b39cf3bf3db36f6b"`);
    await queryRunner.query(`DROP INDEX "IDX_dcf30430ba207bf1887bd384a6"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_track" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "recordingMbid" varchar, "position" varchar NOT NULL, "discNumber" integer NOT NULL DEFAULT (1), "trackNumber" integer NOT NULL DEFAULT (0), "title" varchar NOT NULL, "artistCredit" varchar NOT NULL DEFAULT (''), "lengthMs" integer, "status" integer NOT NULL DEFAULT (1), "fileFormat" varchar, "sourceIds" text, "peaks" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, CONSTRAINT "UQ_track_media_position" UNIQUE ("mediaId", "position"), CONSTRAINT "FK_30e3a3e4a7ceaf5127fb35322ff" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_track"("id", "recordingMbid", "position", "discNumber", "trackNumber", "title", "artistCredit", "lengthMs", "status", "fileFormat", "sourceIds", "peaks", "createdAt", "updatedAt", "mediaId") SELECT "id", "recordingMbid", "position", "discNumber", "trackNumber", "title", "artistCredit", "lengthMs", "status", "fileFormat", "sourceIds", "peaks", "createdAt", "updatedAt", "mediaId" FROM "track"`
    );
    await queryRunner.query(`DROP TABLE "track"`);
    await queryRunner.query(`ALTER TABLE "temporary_track" RENAME TO "track"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_30e3a3e4a7ceaf5127fb35322f" ON "track" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47c7f19876b39cf3bf3db36f6b" ON "track" ("recordingMbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dcf30430ba207bf1887bd384a6" ON "track" ("status") `
    );
    await queryRunner.query(`DROP INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5"`);
    await queryRunner.query(`DROP INDEX "IDX_14760a9c6609e37fe633ddd02c"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_track_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestId" integer, "trackId" integer, CONSTRAINT "FK_d6b4a4b7ba424a22ab38e4a3e5c" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_14760a9c6609e37fe633ddd02c4" FOREIGN KEY ("trackId") REFERENCES "track" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_track_request"("id", "status", "createdAt", "updatedAt", "requestId", "trackId") SELECT "id", "status", "createdAt", "updatedAt", "requestId", "trackId" FROM "track_request"`
    );
    await queryRunner.query(`DROP TABLE "track_request"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_track_request" RENAME TO "track_request"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5" ON "track_request" ("requestId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14760a9c6609e37fe633ddd02c" ON "track_request" ("trackId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_a1aa713f41c99e9d10c48da75a"`);
    await queryRunner.query(`DROP INDEX "IDX_6997bee94720f1ecb7f3113709"`);
    await queryRunner.query(`DROP INDEX "IDX_f4fc4efa14c3ba2b29c4525fa1"`);
    await queryRunner.query(`DROP INDEX "IDX_request_media_scope_status"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "scope" varchar NOT NULL, "isAutoApproved" boolean NOT NULL DEFAULT (0), "isAutoRequest" boolean NOT NULL DEFAULT (0), "ignoreQuota" boolean NOT NULL DEFAULT (0), "releaseCount" integer NOT NULL DEFAULT (0), "trackCount" integer NOT NULL DEFAULT (0), "serverId" integer, "qualityProfileId" integer, "metadataProfileId" integer, "rootFolder" varchar, "isHiRes" boolean NOT NULL DEFAULT (0), "monitorFuture" boolean NOT NULL DEFAULT (0), "downloadProgress" integer, "failureReason" varchar, "declineReason" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "requestedById" integer, "modifiedById" integer, CONSTRAINT "FK_a1aa713f41c99e9d10c48da75a0" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_6997bee94720f1ecb7f31137095" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_f4fc4efa14c3ba2b29c4525fa15" FOREIGN KEY ("modifiedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media_request"("id", "status", "scope", "isAutoApproved", "isAutoRequest", "ignoreQuota", "releaseCount", "trackCount", "serverId", "qualityProfileId", "metadataProfileId", "rootFolder", "isHiRes", "monitorFuture", "downloadProgress", "failureReason", "declineReason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById") SELECT "id", "status", "scope", "isAutoApproved", "isAutoRequest", "ignoreQuota", "releaseCount", "trackCount", "serverId", "qualityProfileId", "metadataProfileId", "rootFolder", "isHiRes", "monitorFuture", "downloadProgress", "failureReason", "declineReason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById" FROM "media_request"`
    );
    await queryRunner.query(`DROP TABLE "media_request"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_media_request" RENAME TO "media_request"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a1aa713f41c99e9d10c48da75a" ON "media_request" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6997bee94720f1ecb7f3113709" ON "media_request" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f4fc4efa14c3ba2b29c4525fa1" ON "media_request" ("modifiedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_media_scope_status" ON "media_request" ("mediaId", "scope", "status") `
    );
    await queryRunner.query(`DROP INDEX "IDX_cbb73271b5059b373cf1ea0e18"`);
    await queryRunner.query(`DROP INDEX "IDX_ae34e6b153a90672eb9dc4857d"`);
    await queryRunner.query(`DROP INDEX "IDX_6641da8d831b93dfcb429f8b8b"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_watchlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "source" varchar NOT NULL DEFAULT ('manual'), "mediaType" varchar NOT NULL, "title" varchar NOT NULL, "mbid" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestedById" integer, "mediaId" integer, CONSTRAINT "UNIQUE_USER_DB" UNIQUE ("mbid", "mediaType", "requestedById"), CONSTRAINT "FK_ae34e6b153a90672eb9dc4857d7" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_6641da8d831b93dfcb429f8b8bc" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_watchlist"("id", "source", "mediaType", "title", "mbid", "createdAt", "updatedAt", "requestedById", "mediaId") SELECT "id", "source", "mediaType", "title", "mbid", "createdAt", "updatedAt", "requestedById", "mediaId" FROM "watchlist"`
    );
    await queryRunner.query(`DROP TABLE "watchlist"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_watchlist" RENAME TO "watchlist"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbb73271b5059b373cf1ea0e18" ON "watchlist" ("mbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae34e6b153a90672eb9dc4857d" ON "watchlist" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6641da8d831b93dfcb429f8b8b" ON "watchlist" ("mediaId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_db4c4bfb7727d438b35364fbd0"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_linked_account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" varchar NOT NULL, "externalUsername" varchar NOT NULL DEFAULT (''), "secret" text NOT NULL, "scopes" varchar, "expiresAt" datetime, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastUsedAt" datetime, "userId" integer, CONSTRAINT "UQ_linked_account_user_provider" UNIQUE ("userId", "provider"), CONSTRAINT "FK_db4c4bfb7727d438b35364fbd02" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_linked_account"("id", "provider", "externalUsername", "secret", "scopes", "expiresAt", "createdAt", "lastUsedAt", "userId") SELECT "id", "provider", "externalUsername", "secret", "scopes", "expiresAt", "createdAt", "lastUsedAt", "userId" FROM "linked_account"`
    );
    await queryRunner.query(`DROP TABLE "linked_account"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_linked_account" RENAME TO "linked_account"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db4c4bfb7727d438b35364fbd0" ON "linked_account" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_03f7958328e311761b0de675fb"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_user_push_subscription" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "endpoint" varchar NOT NULL, "p256dh" varchar NOT NULL, "auth" varchar NOT NULL, "userAgent" varchar, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "UQ_6427d07d9a171a3a1ab87480005" UNIQUE ("endpoint", "userId"), CONSTRAINT "FK_03f7958328e311761b0de675fbe" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_user_push_subscription"("id", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "userId") SELECT "id", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "userId" FROM "user_push_subscription"`
    );
    await queryRunner.query(`DROP TABLE "user_push_subscription"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_user_push_subscription" RENAME TO "user_push_subscription"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03f7958328e311761b0de675fb" ON "user_push_subscription" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "temporary_user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "discoverRegion" varchar, "pgpKey" varchar, "discordIds" text, "pushbulletAccessToken" varchar, "pushoverApplicationToken" varchar, "pushoverUserKey" varchar, "pushoverSound" varchar, "telegramChatId" varchar, "telegramMessageThreadId" varchar, "telegramSendSilently" boolean, "autoRequestSpotifySaved" boolean NOT NULL DEFAULT (0), "scrobbleEnabled" boolean NOT NULL DEFAULT (1), "notificationTypes" text, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_user_settings"("id", "locale", "discoverRegion", "pgpKey", "discordIds", "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramMessageThreadId", "telegramSendSilently", "autoRequestSpotifySaved", "scrobbleEnabled", "notificationTypes", "userId") SELECT "id", "locale", "discoverRegion", "pgpKey", "discordIds", "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramMessageThreadId", "telegramSendSilently", "autoRequestSpotifySaved", "scrobbleEnabled", "notificationTypes", "userId" FROM "user_settings"`
    );
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_user_settings" RENAME TO "user_settings"`
    );
    await queryRunner.query(`DROP INDEX "IDX_ef734727840f2a6cd78c293378"`);
    await queryRunner.query(`DROP INDEX "IDX_8ebca0c0b75dd511211f8a9c1f"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_app_password" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "hash" varchar NOT NULL, "encryptedSecret" text NOT NULL, "accessToken" varchar, "lastUsedAt" datetime, "lastUsedClient" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "FK_ef734727840f2a6cd78c293378f" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_app_password"("id", "name", "hash", "encryptedSecret", "accessToken", "lastUsedAt", "lastUsedClient", "createdAt", "userId") SELECT "id", "name", "hash", "encryptedSecret", "accessToken", "lastUsedAt", "lastUsedClient", "createdAt", "userId" FROM "app_password"`
    );
    await queryRunner.query(`DROP TABLE "app_password"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_app_password" RENAME TO "app_password"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef734727840f2a6cd78c293378" ON "app_password" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ebca0c0b75dd511211f8a9c1f" ON "app_password" ("accessToken") `
    );
    await queryRunner.query(`DROP INDEX "IDX_5128ba16a1effbbd06740606fb"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_import_job" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "source" varchar NOT NULL, "url" varchar NOT NULL, "title" varchar, "status" varchar NOT NULL DEFAULT ('resolving'), "error" varchar, "matched" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "FK_5128ba16a1effbbd06740606fb7" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_import_job"("id", "source", "url", "title", "status", "error", "matched", "createdAt", "userId") SELECT "id", "source", "url", "title", "status", "error", "matched", "createdAt", "userId" FROM "import_job"`
    );
    await queryRunner.query(`DROP TABLE "import_job"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_import_job" RENAME TO "import_job"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5128ba16a1effbbd06740606fb" ON "import_job" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_9b9b229772d88966e7d9959d90"`);
    await queryRunner.query(`DROP INDEX "IDX_775b9c3be0f7e2241229c8fff7"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_playlist_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "position" integer NOT NULL DEFAULT (0), "playlistId" integer, "trackId" integer, CONSTRAINT "FK_9b9b229772d88966e7d9959d907" FOREIGN KEY ("playlistId") REFERENCES "playlist" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_775b9c3be0f7e2241229c8fff7f" FOREIGN KEY ("trackId") REFERENCES "track" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_playlist_item"("id", "position", "playlistId", "trackId") SELECT "id", "position", "playlistId", "trackId" FROM "playlist_item"`
    );
    await queryRunner.query(`DROP TABLE "playlist_item"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_playlist_item" RENAME TO "playlist_item"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b9b229772d88966e7d9959d90" ON "playlist_item" ("playlistId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_775b9c3be0f7e2241229c8fff7" ON "playlist_item" ("trackId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_92ca9b9b5394093adb6e5f55c4"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_playlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "comment" varchar, "isPublic" boolean NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "FK_92ca9b9b5394093adb6e5f55c4b" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_playlist"("id", "name", "comment", "isPublic", "createdAt", "updatedAt", "userId") SELECT "id", "name", "comment", "isPublic", "createdAt", "updatedAt", "userId" FROM "playlist"`
    );
    await queryRunner.query(`DROP TABLE "playlist"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_playlist" RENAME TO "playlist"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92ca9b9b5394093adb6e5f55c4" ON "playlist" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_2c0066088d4849e34b474acc19"`);
    await queryRunner.query(`DROP INDEX "IDX_b8a227c0ab7e5bf83b1c0845db"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_scrobble_queue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "recordingMbid" varchar, "releaseGroupMbid" varchar, "trackId" integer, "artist" varchar NOT NULL, "track" varchar NOT NULL, "album" varchar, "durationMs" integer, "playedAt" datetime NOT NULL, "source" varchar NOT NULL, "targets" text NOT NULL, "attempts" integer NOT NULL DEFAULT (0), "lastError" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "FK_2c0066088d4849e34b474acc19e" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_scrobble_queue"("id", "recordingMbid", "releaseGroupMbid", "trackId", "artist", "track", "album", "durationMs", "playedAt", "source", "targets", "attempts", "lastError", "createdAt", "userId") SELECT "id", "recordingMbid", "releaseGroupMbid", "trackId", "artist", "track", "album", "durationMs", "playedAt", "source", "targets", "attempts", "lastError", "createdAt", "userId" FROM "scrobble_queue"`
    );
    await queryRunner.query(`DROP TABLE "scrobble_queue"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_scrobble_queue" RENAME TO "scrobble_queue"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c0066088d4849e34b474acc19" ON "scrobble_queue" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8a227c0ab7e5bf83b1c0845db" ON "scrobble_queue" ("playedAt") `
    );
    await queryRunner.query(`DROP INDEX "IDX_2018c9deccb66c6db30a1ddbd1"`);
    await queryRunner.query(`DROP INDEX "IDX_b0fe75bc5cb0c9c7369f6499c6"`);
    await queryRunner.query(`DROP INDEX "IDX_1be6158f58d57dfcfb6507745d"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_star" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "trackId" integer, "mediaId" integer, CONSTRAINT "UQ_star_user_track_media" UNIQUE ("userId", "trackId", "mediaId"), CONSTRAINT "FK_2018c9deccb66c6db30a1ddbd1d" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_b0fe75bc5cb0c9c7369f6499c68" FOREIGN KEY ("trackId") REFERENCES "track" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_1be6158f58d57dfcfb6507745d2" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_star"("id", "createdAt", "userId", "trackId", "mediaId") SELECT "id", "createdAt", "userId", "trackId", "mediaId" FROM "star"`
    );
    await queryRunner.query(`DROP TABLE "star"`);
    await queryRunner.query(`ALTER TABLE "temporary_star" RENAME TO "star"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_2018c9deccb66c6db30a1ddbd1" ON "star" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0fe75bc5cb0c9c7369f6499c6" ON "star" ("trackId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1be6158f58d57dfcfb6507745d" ON "star" ("mediaId") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_1be6158f58d57dfcfb6507745d"`);
    await queryRunner.query(`DROP INDEX "IDX_b0fe75bc5cb0c9c7369f6499c6"`);
    await queryRunner.query(`DROP INDEX "IDX_2018c9deccb66c6db30a1ddbd1"`);
    await queryRunner.query(`ALTER TABLE "star" RENAME TO "temporary_star"`);
    await queryRunner.query(
      `CREATE TABLE "star" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "trackId" integer, "mediaId" integer, CONSTRAINT "UQ_star_user_track_media" UNIQUE ("userId", "trackId", "mediaId"))`
    );
    await queryRunner.query(
      `INSERT INTO "star"("id", "createdAt", "userId", "trackId", "mediaId") SELECT "id", "createdAt", "userId", "trackId", "mediaId" FROM "temporary_star"`
    );
    await queryRunner.query(`DROP TABLE "temporary_star"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_1be6158f58d57dfcfb6507745d" ON "star" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0fe75bc5cb0c9c7369f6499c6" ON "star" ("trackId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2018c9deccb66c6db30a1ddbd1" ON "star" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_b8a227c0ab7e5bf83b1c0845db"`);
    await queryRunner.query(`DROP INDEX "IDX_2c0066088d4849e34b474acc19"`);
    await queryRunner.query(
      `ALTER TABLE "scrobble_queue" RENAME TO "temporary_scrobble_queue"`
    );
    await queryRunner.query(
      `CREATE TABLE "scrobble_queue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "recordingMbid" varchar, "releaseGroupMbid" varchar, "trackId" integer, "artist" varchar NOT NULL, "track" varchar NOT NULL, "album" varchar, "durationMs" integer, "playedAt" datetime NOT NULL, "source" varchar NOT NULL, "targets" text NOT NULL, "attempts" integer NOT NULL DEFAULT (0), "lastError" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "scrobble_queue"("id", "recordingMbid", "releaseGroupMbid", "trackId", "artist", "track", "album", "durationMs", "playedAt", "source", "targets", "attempts", "lastError", "createdAt", "userId") SELECT "id", "recordingMbid", "releaseGroupMbid", "trackId", "artist", "track", "album", "durationMs", "playedAt", "source", "targets", "attempts", "lastError", "createdAt", "userId" FROM "temporary_scrobble_queue"`
    );
    await queryRunner.query(`DROP TABLE "temporary_scrobble_queue"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_b8a227c0ab7e5bf83b1c0845db" ON "scrobble_queue" ("playedAt") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c0066088d4849e34b474acc19" ON "scrobble_queue" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_92ca9b9b5394093adb6e5f55c4"`);
    await queryRunner.query(
      `ALTER TABLE "playlist" RENAME TO "temporary_playlist"`
    );
    await queryRunner.query(
      `CREATE TABLE "playlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "comment" varchar, "isPublic" boolean NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "playlist"("id", "name", "comment", "isPublic", "createdAt", "updatedAt", "userId") SELECT "id", "name", "comment", "isPublic", "createdAt", "updatedAt", "userId" FROM "temporary_playlist"`
    );
    await queryRunner.query(`DROP TABLE "temporary_playlist"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_92ca9b9b5394093adb6e5f55c4" ON "playlist" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_775b9c3be0f7e2241229c8fff7"`);
    await queryRunner.query(`DROP INDEX "IDX_9b9b229772d88966e7d9959d90"`);
    await queryRunner.query(
      `ALTER TABLE "playlist_item" RENAME TO "temporary_playlist_item"`
    );
    await queryRunner.query(
      `CREATE TABLE "playlist_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "position" integer NOT NULL DEFAULT (0), "playlistId" integer, "trackId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "playlist_item"("id", "position", "playlistId", "trackId") SELECT "id", "position", "playlistId", "trackId" FROM "temporary_playlist_item"`
    );
    await queryRunner.query(`DROP TABLE "temporary_playlist_item"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_775b9c3be0f7e2241229c8fff7" ON "playlist_item" ("trackId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b9b229772d88966e7d9959d90" ON "playlist_item" ("playlistId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_5128ba16a1effbbd06740606fb"`);
    await queryRunner.query(
      `ALTER TABLE "import_job" RENAME TO "temporary_import_job"`
    );
    await queryRunner.query(
      `CREATE TABLE "import_job" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "source" varchar NOT NULL, "url" varchar NOT NULL, "title" varchar, "status" varchar NOT NULL DEFAULT ('resolving'), "error" varchar, "matched" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "import_job"("id", "source", "url", "title", "status", "error", "matched", "createdAt", "userId") SELECT "id", "source", "url", "title", "status", "error", "matched", "createdAt", "userId" FROM "temporary_import_job"`
    );
    await queryRunner.query(`DROP TABLE "temporary_import_job"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_5128ba16a1effbbd06740606fb" ON "import_job" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_8ebca0c0b75dd511211f8a9c1f"`);
    await queryRunner.query(`DROP INDEX "IDX_ef734727840f2a6cd78c293378"`);
    await queryRunner.query(
      `ALTER TABLE "app_password" RENAME TO "temporary_app_password"`
    );
    await queryRunner.query(
      `CREATE TABLE "app_password" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "hash" varchar NOT NULL, "encryptedSecret" text NOT NULL, "accessToken" varchar, "lastUsedAt" datetime, "lastUsedClient" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "app_password"("id", "name", "hash", "encryptedSecret", "accessToken", "lastUsedAt", "lastUsedClient", "createdAt", "userId") SELECT "id", "name", "hash", "encryptedSecret", "accessToken", "lastUsedAt", "lastUsedClient", "createdAt", "userId" FROM "temporary_app_password"`
    );
    await queryRunner.query(`DROP TABLE "temporary_app_password"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_8ebca0c0b75dd511211f8a9c1f" ON "app_password" ("accessToken") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef734727840f2a6cd78c293378" ON "app_password" ("userId") `
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" RENAME TO "temporary_user_settings"`
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "discoverRegion" varchar, "pgpKey" varchar, "discordIds" text, "pushbulletAccessToken" varchar, "pushoverApplicationToken" varchar, "pushoverUserKey" varchar, "pushoverSound" varchar, "telegramChatId" varchar, "telegramMessageThreadId" varchar, "telegramSendSilently" boolean, "autoRequestSpotifySaved" boolean NOT NULL DEFAULT (0), "scrobbleEnabled" boolean NOT NULL DEFAULT (1), "notificationTypes" text, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"))`
    );
    await queryRunner.query(
      `INSERT INTO "user_settings"("id", "locale", "discoverRegion", "pgpKey", "discordIds", "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramMessageThreadId", "telegramSendSilently", "autoRequestSpotifySaved", "scrobbleEnabled", "notificationTypes", "userId") SELECT "id", "locale", "discoverRegion", "pgpKey", "discordIds", "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramMessageThreadId", "telegramSendSilently", "autoRequestSpotifySaved", "scrobbleEnabled", "notificationTypes", "userId" FROM "temporary_user_settings"`
    );
    await queryRunner.query(`DROP TABLE "temporary_user_settings"`);
    await queryRunner.query(`DROP INDEX "IDX_03f7958328e311761b0de675fb"`);
    await queryRunner.query(
      `ALTER TABLE "user_push_subscription" RENAME TO "temporary_user_push_subscription"`
    );
    await queryRunner.query(
      `CREATE TABLE "user_push_subscription" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "endpoint" varchar NOT NULL, "p256dh" varchar NOT NULL, "auth" varchar NOT NULL, "userAgent" varchar, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "userId" integer, CONSTRAINT "UQ_6427d07d9a171a3a1ab87480005" UNIQUE ("endpoint", "userId"))`
    );
    await queryRunner.query(
      `INSERT INTO "user_push_subscription"("id", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "userId") SELECT "id", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "userId" FROM "temporary_user_push_subscription"`
    );
    await queryRunner.query(`DROP TABLE "temporary_user_push_subscription"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_03f7958328e311761b0de675fb" ON "user_push_subscription" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_db4c4bfb7727d438b35364fbd0"`);
    await queryRunner.query(
      `ALTER TABLE "linked_account" RENAME TO "temporary_linked_account"`
    );
    await queryRunner.query(
      `CREATE TABLE "linked_account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" varchar NOT NULL, "externalUsername" varchar NOT NULL DEFAULT (''), "secret" text NOT NULL, "scopes" varchar, "expiresAt" datetime, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastUsedAt" datetime, "userId" integer, CONSTRAINT "UQ_linked_account_user_provider" UNIQUE ("userId", "provider"))`
    );
    await queryRunner.query(
      `INSERT INTO "linked_account"("id", "provider", "externalUsername", "secret", "scopes", "expiresAt", "createdAt", "lastUsedAt", "userId") SELECT "id", "provider", "externalUsername", "secret", "scopes", "expiresAt", "createdAt", "lastUsedAt", "userId" FROM "temporary_linked_account"`
    );
    await queryRunner.query(`DROP TABLE "temporary_linked_account"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_db4c4bfb7727d438b35364fbd0" ON "linked_account" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_6641da8d831b93dfcb429f8b8b"`);
    await queryRunner.query(`DROP INDEX "IDX_ae34e6b153a90672eb9dc4857d"`);
    await queryRunner.query(`DROP INDEX "IDX_cbb73271b5059b373cf1ea0e18"`);
    await queryRunner.query(
      `ALTER TABLE "watchlist" RENAME TO "temporary_watchlist"`
    );
    await queryRunner.query(
      `CREATE TABLE "watchlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "source" varchar NOT NULL DEFAULT ('manual'), "mediaType" varchar NOT NULL, "title" varchar NOT NULL, "mbid" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestedById" integer, "mediaId" integer, CONSTRAINT "UNIQUE_USER_DB" UNIQUE ("mbid", "mediaType", "requestedById"))`
    );
    await queryRunner.query(
      `INSERT INTO "watchlist"("id", "source", "mediaType", "title", "mbid", "createdAt", "updatedAt", "requestedById", "mediaId") SELECT "id", "source", "mediaType", "title", "mbid", "createdAt", "updatedAt", "requestedById", "mediaId" FROM "temporary_watchlist"`
    );
    await queryRunner.query(`DROP TABLE "temporary_watchlist"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_6641da8d831b93dfcb429f8b8b" ON "watchlist" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae34e6b153a90672eb9dc4857d" ON "watchlist" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cbb73271b5059b373cf1ea0e18" ON "watchlist" ("mbid") `
    );
    await queryRunner.query(`DROP INDEX "IDX_request_media_scope_status"`);
    await queryRunner.query(`DROP INDEX "IDX_f4fc4efa14c3ba2b29c4525fa1"`);
    await queryRunner.query(`DROP INDEX "IDX_6997bee94720f1ecb7f3113709"`);
    await queryRunner.query(`DROP INDEX "IDX_a1aa713f41c99e9d10c48da75a"`);
    await queryRunner.query(
      `ALTER TABLE "media_request" RENAME TO "temporary_media_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "scope" varchar NOT NULL, "isAutoApproved" boolean NOT NULL DEFAULT (0), "isAutoRequest" boolean NOT NULL DEFAULT (0), "ignoreQuota" boolean NOT NULL DEFAULT (0), "releaseCount" integer NOT NULL DEFAULT (0), "trackCount" integer NOT NULL DEFAULT (0), "serverId" integer, "qualityProfileId" integer, "metadataProfileId" integer, "rootFolder" varchar, "isHiRes" boolean NOT NULL DEFAULT (0), "monitorFuture" boolean NOT NULL DEFAULT (0), "downloadProgress" integer, "failureReason" varchar, "declineReason" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "requestedById" integer, "modifiedById" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "media_request"("id", "status", "scope", "isAutoApproved", "isAutoRequest", "ignoreQuota", "releaseCount", "trackCount", "serverId", "qualityProfileId", "metadataProfileId", "rootFolder", "isHiRes", "monitorFuture", "downloadProgress", "failureReason", "declineReason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById") SELECT "id", "status", "scope", "isAutoApproved", "isAutoRequest", "ignoreQuota", "releaseCount", "trackCount", "serverId", "qualityProfileId", "metadataProfileId", "rootFolder", "isHiRes", "monitorFuture", "downloadProgress", "failureReason", "declineReason", "createdAt", "updatedAt", "mediaId", "requestedById", "modifiedById" FROM "temporary_media_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_media_request"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_request_media_scope_status" ON "media_request" ("mediaId", "scope", "status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f4fc4efa14c3ba2b29c4525fa1" ON "media_request" ("modifiedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6997bee94720f1ecb7f3113709" ON "media_request" ("requestedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a1aa713f41c99e9d10c48da75a" ON "media_request" ("mediaId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_14760a9c6609e37fe633ddd02c"`);
    await queryRunner.query(`DROP INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5"`);
    await queryRunner.query(
      `ALTER TABLE "track_request" RENAME TO "temporary_track_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "track_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestId" integer, "trackId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "track_request"("id", "status", "createdAt", "updatedAt", "requestId", "trackId") SELECT "id", "status", "createdAt", "updatedAt", "requestId", "trackId" FROM "temporary_track_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_track_request"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_14760a9c6609e37fe633ddd02c" ON "track_request" ("trackId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5" ON "track_request" ("requestId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_dcf30430ba207bf1887bd384a6"`);
    await queryRunner.query(`DROP INDEX "IDX_47c7f19876b39cf3bf3db36f6b"`);
    await queryRunner.query(`DROP INDEX "IDX_30e3a3e4a7ceaf5127fb35322f"`);
    await queryRunner.query(`ALTER TABLE "track" RENAME TO "temporary_track"`);
    await queryRunner.query(
      `CREATE TABLE "track" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "recordingMbid" varchar, "position" varchar NOT NULL, "discNumber" integer NOT NULL DEFAULT (1), "trackNumber" integer NOT NULL DEFAULT (0), "title" varchar NOT NULL, "artistCredit" varchar NOT NULL DEFAULT (''), "lengthMs" integer, "status" integer NOT NULL DEFAULT (1), "fileFormat" varchar, "sourceIds" text, "peaks" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, CONSTRAINT "UQ_track_media_position" UNIQUE ("mediaId", "position"))`
    );
    await queryRunner.query(
      `INSERT INTO "track"("id", "recordingMbid", "position", "discNumber", "trackNumber", "title", "artistCredit", "lengthMs", "status", "fileFormat", "sourceIds", "peaks", "createdAt", "updatedAt", "mediaId") SELECT "id", "recordingMbid", "position", "discNumber", "trackNumber", "title", "artistCredit", "lengthMs", "status", "fileFormat", "sourceIds", "peaks", "createdAt", "updatedAt", "mediaId" FROM "temporary_track"`
    );
    await queryRunner.query(`DROP TABLE "temporary_track"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dcf30430ba207bf1887bd384a6" ON "track" ("status") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47c7f19876b39cf3bf3db36f6b" ON "track" ("recordingMbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30e3a3e4a7ceaf5127fb35322f" ON "track" ("mediaId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_da88a1019c850d1a7b143ca02e"`);
    await queryRunner.query(`DROP INDEX "IDX_10b17b49d1ee77e7184216001e"`);
    await queryRunner.query(`DROP INDEX "IDX_276e20d053f3cff1645803c95d"`);
    await queryRunner.query(`DROP INDEX "IDX_53d04c07c3f4f54eae372ed665"`);
    await queryRunner.query(`ALTER TABLE "issue" RENAME TO "temporary_issue"`);
    await queryRunner.query(
      `CREATE TABLE "issue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "issueType" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "problemTracks" text, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "createdById" integer, "modifiedById" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "issue"("id", "issueType", "status", "problemTracks", "createdAt", "updatedAt", "mediaId", "createdById", "modifiedById") SELECT "id", "issueType", "status", "problemTracks", "createdAt", "updatedAt", "mediaId", "createdById", "modifiedById" FROM "temporary_issue"`
    );
    await queryRunner.query(`DROP TABLE "temporary_issue"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_da88a1019c850d1a7b143ca02e" ON "issue" ("modifiedById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10b17b49d1ee77e7184216001e" ON "issue" ("createdById") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_276e20d053f3cff1645803c95d" ON "issue" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53d04c07c3f4f54eae372ed665" ON "issue" ("issueType") `
    );
    await queryRunner.query(`DROP INDEX "IDX_180710fead1c94ca499c57a7d4"`);
    await queryRunner.query(`DROP INDEX "IDX_707b033c2d0653f75213614789"`);
    await queryRunner.query(
      `ALTER TABLE "issue_comment" RENAME TO "temporary_issue_comment"`
    );
    await queryRunner.query(
      `CREATE TABLE "issue_comment" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "message" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "issueId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "issue_comment"("id", "message", "createdAt", "updatedAt", "userId", "issueId") SELECT "id", "message", "createdAt", "updatedAt", "userId", "issueId" FROM "temporary_issue_comment"`
    );
    await queryRunner.query(`DROP TABLE "temporary_issue_comment"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_180710fead1c94ca499c57a7d4" ON "issue_comment" ("issueId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_707b033c2d0653f75213614789" ON "issue_comment" ("userId") `
    );
    await queryRunner.query(`DROP INDEX "IDX_356721a49f145aa439c16e6b99"`);
    await queryRunner.query(`DROP INDEX "IDX_526a98c8311a9b1b83189eb760"`);
    await queryRunner.query(
      `ALTER TABLE "blocklist" RENAME TO "temporary_blocklist"`
    );
    await queryRunner.query(
      `CREATE TABLE "blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "title" varchar, "mbid" varchar NOT NULL, "blocklistedTags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "mediaId" integer, CONSTRAINT "UQ_9d36a1ac9a412ba6f36c60a6897" UNIQUE ("mbid", "mediaType"), CONSTRAINT "REL_5c8af2d0e83b3be6d250eccc19" UNIQUE ("mediaId"))`
    );
    await queryRunner.query(
      `INSERT INTO "blocklist"("id", "mediaType", "title", "mbid", "blocklistedTags", "createdAt", "userId", "mediaId") SELECT "id", "mediaType", "title", "mbid", "blocklistedTags", "createdAt", "userId", "mediaId" FROM "temporary_blocklist"`
    );
    await queryRunner.query(`DROP TABLE "temporary_blocklist"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_526a98c8311a9b1b83189eb760" ON "blocklist" ("mbid") `
    );
    await queryRunner.query(`DROP INDEX "IDX_1be6158f58d57dfcfb6507745d"`);
    await queryRunner.query(`DROP INDEX "IDX_b0fe75bc5cb0c9c7369f6499c6"`);
    await queryRunner.query(`DROP INDEX "IDX_2018c9deccb66c6db30a1ddbd1"`);
    await queryRunner.query(`DROP TABLE "star"`);
    await queryRunner.query(`DROP INDEX "IDX_28c5d1d16da7908c97c9bc2f74"`);
    await queryRunner.query(`DROP TABLE "session"`);
    await queryRunner.query(`DROP INDEX "IDX_b8a227c0ab7e5bf83b1c0845db"`);
    await queryRunner.query(`DROP INDEX "IDX_2c0066088d4849e34b474acc19"`);
    await queryRunner.query(`DROP TABLE "scrobble_queue"`);
    await queryRunner.query(`DROP INDEX "IDX_92ca9b9b5394093adb6e5f55c4"`);
    await queryRunner.query(`DROP TABLE "playlist"`);
    await queryRunner.query(`DROP INDEX "IDX_775b9c3be0f7e2241229c8fff7"`);
    await queryRunner.query(`DROP INDEX "IDX_9b9b229772d88966e7d9959d90"`);
    await queryRunner.query(`DROP TABLE "playlist_item"`);
    await queryRunner.query(`DROP TABLE "override_rule"`);
    await queryRunner.query(`DROP INDEX "IDX_5128ba16a1effbbd06740606fb"`);
    await queryRunner.query(`DROP TABLE "import_job"`);
    await queryRunner.query(`DROP INDEX "IDX_1642f51b7417f5ddffd32c7134"`);
    await queryRunner.query(`DROP INDEX "IDX_b966c85d9a41aeb737fea8672d"`);
    await queryRunner.query(`DROP INDEX "IDX_3a4e21f37e181fc529203d258a"`);
    await queryRunner.query(`DROP TABLE "event"`);
    await queryRunner.query(`DROP TABLE "discover_slider"`);
    await queryRunner.query(`DROP INDEX "IDX_8ebca0c0b75dd511211f8a9c1f"`);
    await queryRunner.query(`DROP INDEX "IDX_ef734727840f2a6cd78c293378"`);
    await queryRunner.query(`DROP TABLE "app_password"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(`DROP INDEX "IDX_03f7958328e311761b0de675fb"`);
    await queryRunner.query(`DROP TABLE "user_push_subscription"`);
    await queryRunner.query(`DROP INDEX "IDX_db4c4bfb7727d438b35364fbd0"`);
    await queryRunner.query(`DROP TABLE "linked_account"`);
    await queryRunner.query(`DROP INDEX "IDX_6641da8d831b93dfcb429f8b8b"`);
    await queryRunner.query(`DROP INDEX "IDX_ae34e6b153a90672eb9dc4857d"`);
    await queryRunner.query(`DROP INDEX "IDX_cbb73271b5059b373cf1ea0e18"`);
    await queryRunner.query(`DROP TABLE "watchlist"`);
    await queryRunner.query(`DROP INDEX "IDX_0d04ac96042a170a457c6f11ae"`);
    await queryRunner.query(`DROP INDEX "IDX_c730c2d67f271a372c39a07b7e"`);
    await queryRunner.query(`DROP INDEX "IDX_fadf745b3868369182773ffd89"`);
    await queryRunner.query(`DROP INDEX "IDX_8e2a99bfef02f8f080442ba4d2"`);
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`DROP INDEX "IDX_request_media_scope_status"`);
    await queryRunner.query(`DROP INDEX "IDX_f4fc4efa14c3ba2b29c4525fa1"`);
    await queryRunner.query(`DROP INDEX "IDX_6997bee94720f1ecb7f3113709"`);
    await queryRunner.query(`DROP INDEX "IDX_a1aa713f41c99e9d10c48da75a"`);
    await queryRunner.query(`DROP TABLE "media_request"`);
    await queryRunner.query(`DROP INDEX "IDX_14760a9c6609e37fe633ddd02c"`);
    await queryRunner.query(`DROP INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5"`);
    await queryRunner.query(`DROP TABLE "track_request"`);
    await queryRunner.query(`DROP INDEX "IDX_dcf30430ba207bf1887bd384a6"`);
    await queryRunner.query(`DROP INDEX "IDX_47c7f19876b39cf3bf3db36f6b"`);
    await queryRunner.query(`DROP INDEX "IDX_30e3a3e4a7ceaf5127fb35322f"`);
    await queryRunner.query(`DROP TABLE "track"`);
    await queryRunner.query(`DROP INDEX "IDX_da88a1019c850d1a7b143ca02e"`);
    await queryRunner.query(`DROP INDEX "IDX_10b17b49d1ee77e7184216001e"`);
    await queryRunner.query(`DROP INDEX "IDX_276e20d053f3cff1645803c95d"`);
    await queryRunner.query(`DROP INDEX "IDX_53d04c07c3f4f54eae372ed665"`);
    await queryRunner.query(`DROP TABLE "issue"`);
    await queryRunner.query(`DROP INDEX "IDX_180710fead1c94ca499c57a7d4"`);
    await queryRunner.query(`DROP INDEX "IDX_707b033c2d0653f75213614789"`);
    await queryRunner.query(`DROP TABLE "issue_comment"`);
    await queryRunner.query(`DROP INDEX "IDX_356721a49f145aa439c16e6b99"`);
    await queryRunner.query(`DROP INDEX "IDX_526a98c8311a9b1b83189eb760"`);
    await queryRunner.query(`DROP TABLE "blocklist"`);
  }
}
