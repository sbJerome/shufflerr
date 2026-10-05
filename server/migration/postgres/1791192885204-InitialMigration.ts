import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMigration1791192885204 implements MigrationInterface {
  name = 'InitialMigration1791192885204';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "blocklist" ("id" SERIAL NOT NULL, "mediaType" character varying NOT NULL, "title" character varying, "mbid" character varying NOT NULL, "blocklistedTags" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, "mediaId" integer, CONSTRAINT "UQ_9d36a1ac9a412ba6f36c60a6897" UNIQUE ("mbid", "mediaType"), CONSTRAINT "REL_5c8af2d0e83b3be6d250eccc19" UNIQUE ("mediaId"), CONSTRAINT "PK_c3a1a2ea2ffda610496ce852572" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_526a98c8311a9b1b83189eb760" ON "blocklist" ("mbid") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "issue_comment" ("id" SERIAL NOT NULL, "message" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, "issueId" integer, CONSTRAINT "PK_2ad05784e2ae661fa409e5e0248" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_707b033c2d0653f75213614789" ON "issue_comment" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_180710fead1c94ca499c57a7d4" ON "issue_comment" ("issueId") `
    );
    await queryRunner.query(
      `CREATE TABLE "issue" ("id" SERIAL NOT NULL, "issueType" integer NOT NULL, "status" integer NOT NULL DEFAULT '1', "problemTracks" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "mediaId" integer, "createdById" integer, "modifiedById" integer, CONSTRAINT "PK_f80e086c249b9f3f3ff2fd321b7" PRIMARY KEY ("id"))`
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
      `CREATE TABLE "track" ("id" SERIAL NOT NULL, "recordingMbid" character varying, "position" character varying NOT NULL, "discNumber" integer NOT NULL DEFAULT '1', "trackNumber" integer NOT NULL DEFAULT '0', "title" character varying NOT NULL, "artistCredit" character varying NOT NULL DEFAULT '', "lengthMs" integer, "status" integer NOT NULL DEFAULT '1', "fileFormat" character varying, "sourceIds" text, "peaks" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "mediaId" integer, CONSTRAINT "UQ_track_media_position" UNIQUE ("mediaId", "position"), CONSTRAINT "PK_0631b9bcf521f8fab3a15f2c37e" PRIMARY KEY ("id"))`
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
      `CREATE TABLE "track_request" ("id" SERIAL NOT NULL, "status" integer NOT NULL DEFAULT '1', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "requestId" integer, "trackId" integer, CONSTRAINT "PK_58f94857b0472bb405bfe1556d3" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b4a4b7ba424a22ab38e4a3e5" ON "track_request" ("requestId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14760a9c6609e37fe633ddd02c" ON "track_request" ("trackId") `
    );
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" SERIAL NOT NULL, "status" integer NOT NULL DEFAULT '1', "scope" character varying NOT NULL, "isAutoApproved" boolean NOT NULL DEFAULT false, "isAutoRequest" boolean NOT NULL DEFAULT false, "ignoreQuota" boolean NOT NULL DEFAULT false, "releaseCount" integer NOT NULL DEFAULT '0', "trackCount" integer NOT NULL DEFAULT '0', "serverId" integer, "qualityProfileId" integer, "metadataProfileId" integer, "rootFolder" character varying, "isHiRes" boolean NOT NULL DEFAULT false, "monitorFuture" boolean NOT NULL DEFAULT false, "downloadProgress" integer, "failureReason" character varying, "declineReason" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "mediaId" integer, "requestedById" integer, "modifiedById" integer, CONSTRAINT "PK_f8334500e8e12db87536558c66c" PRIMARY KEY ("id"))`
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
      `CREATE TABLE "media" ("id" SERIAL NOT NULL, "mediaType" character varying NOT NULL, "mbid" character varying NOT NULL, "artistMbid" character varying, "title" character varying NOT NULL DEFAULT '', "artistName" character varying, "primaryType" character varying, "secondaryTypes" text, "firstReleaseDate" character varying, "status" integer NOT NULL DEFAULT '1', "trackCount" integer, "tracksAvailable" integer NOT NULL DEFAULT '0', "releaseMbid" character varying, "lidarrServerId" integer, "lidarrArtistId" integer, "lidarrAlbumId" integer, "lidarrAddedByShufflerr" boolean NOT NULL DEFAULT false, "plexRatingKey" character varying, "jellyfinItemId" character varying, "navidromeId" character varying, "localPath" character varying, "lastScanAt" TIMESTAMP WITH TIME ZONE, "mediaAddedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_media_type_mbid" UNIQUE ("mediaType", "mbid"), CONSTRAINT "PK_f4e0fcac36e050de337b670d8bd" PRIMARY KEY ("id"))`
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
      `CREATE TABLE "watchlist" ("id" SERIAL NOT NULL, "source" character varying NOT NULL DEFAULT 'manual', "mediaType" character varying NOT NULL, "title" character varying NOT NULL, "mbid" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "requestedById" integer, "mediaId" integer, CONSTRAINT "UNIQUE_USER_DB" UNIQUE ("mbid", "mediaType", "requestedById"), CONSTRAINT "PK_0c8c0dbcc8d379117138e71ad5b" PRIMARY KEY ("id"))`
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
      `CREATE TABLE "linked_account" ("id" SERIAL NOT NULL, "provider" character varying NOT NULL, "externalUsername" character varying NOT NULL DEFAULT '', "secret" text NOT NULL, "scopes" character varying, "expiresAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastUsedAt" TIMESTAMP WITH TIME ZONE, "userId" integer, CONSTRAINT "UQ_linked_account_user_provider" UNIQUE ("userId", "provider"), CONSTRAINT "PK_4430c3285753002ec499852d35c" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db4c4bfb7727d438b35364fbd0" ON "linked_account" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_push_subscription" ("id" SERIAL NOT NULL, "endpoint" character varying NOT NULL, "p256dh" character varying NOT NULL, "auth" character varying NOT NULL, "userAgent" character varying, "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(), "userId" integer, CONSTRAINT "UQ_6427d07d9a171a3a1ab87480005" UNIQUE ("endpoint", "userId"), CONSTRAINT "PK_397020e7be9a4086cc798e0bb63" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03f7958328e311761b0de675fb" ON "user_push_subscription" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" SERIAL NOT NULL, "locale" character varying NOT NULL DEFAULT '', "discoverRegion" character varying, "pgpKey" character varying, "discordIds" text, "pushbulletAccessToken" character varying, "pushoverApplicationToken" character varying, "pushoverUserKey" character varying, "pushoverSound" character varying, "telegramChatId" character varying, "telegramMessageThreadId" character varying, "telegramSendSilently" boolean, "autoRequestSpotifySaved" boolean NOT NULL DEFAULT false, "scrobbleEnabled" boolean NOT NULL DEFAULT true, "notificationTypes" text, "userId" integer, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "PK_00f004f5922a0744d174530d639" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" SERIAL NOT NULL, "email" character varying NOT NULL, "plexUsername" character varying, "jellyfinUsername" character varying, "username" character varying, "password" character varying, "resetPasswordGuid" character varying, "recoveryLinkExpirationDate" TIMESTAMP WITH TIME ZONE, "userType" integer NOT NULL DEFAULT '1', "plexId" integer, "jellyfinUserId" character varying, "jellyfinDeviceId" character varying, "jellyfinAuthToken" character varying, "plexToken" character varying, "permissions" integer NOT NULL DEFAULT '0', "avatar" character varying NOT NULL, "avatarETag" character varying, "avatarVersion" character varying, "albumQuotaLimit" integer, "albumQuotaDays" integer, "trackQuotaLimit" integer, "trackQuotaDays" integer, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "app_password" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "hash" character varying NOT NULL, "encryptedSecret" text NOT NULL, "accessToken" character varying, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "lastUsedClient" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, CONSTRAINT "PK_0f8f2943997c161e5e0681d8799" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef734727840f2a6cd78c293378" ON "app_password" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ebca0c0b75dd511211f8a9c1f" ON "app_password" ("accessToken") `
    );
    await queryRunner.query(
      `CREATE TABLE "discover_slider" ("id" SERIAL NOT NULL, "type" integer NOT NULL, "order" integer NOT NULL, "isBuiltIn" boolean NOT NULL DEFAULT false, "enabled" boolean NOT NULL DEFAULT true, "title" character varying, "data" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_20a71a098d04bae448e4d51db23" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "event" ("id" SERIAL NOT NULL, "provider" character varying NOT NULL, "externalId" character varying NOT NULL, "artistMbid" character varying, "artistName" character varying NOT NULL, "name" character varying, "venue" character varying, "city" character varying, "country" character varying, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "url" character varying NOT NULL, "imageUrl" character varying, "fetchedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_event_provider_external" UNIQUE ("provider", "externalId"), CONSTRAINT "PK_30c2f3bbaf6d34a55f8ae6e4614" PRIMARY KEY ("id"))`
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
      `CREATE TABLE "import_job" ("id" SERIAL NOT NULL, "source" character varying NOT NULL, "url" character varying NOT NULL, "title" character varying, "status" character varying NOT NULL DEFAULT 'resolving', "error" character varying, "matched" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, CONSTRAINT "PK_65b4c7eccb8120972a7b8da7682" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5128ba16a1effbbd06740606fb" ON "import_job" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "override_rule" ("id" SERIAL NOT NULL, "lidarrServiceId" integer, "users" character varying, "genre" character varying, "label" character varying, "primaryType" character varying, "profileId" integer, "metadataProfileId" integer, "rootFolder" character varying, "tags" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_657f810c7b20a4fce45aee8f182" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "playlist_item" ("id" SERIAL NOT NULL, "position" integer NOT NULL DEFAULT '0', "playlistId" integer, "trackId" integer, CONSTRAINT "PK_958bd2e5a3e9728df21b5855dc9" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b9b229772d88966e7d9959d90" ON "playlist_item" ("playlistId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_775b9c3be0f7e2241229c8fff7" ON "playlist_item" ("trackId") `
    );
    await queryRunner.query(
      `CREATE TABLE "playlist" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "comment" character varying, "isPublic" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, CONSTRAINT "PK_538c2893e2024fabc7ae65ad142" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92ca9b9b5394093adb6e5f55c4" ON "playlist" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE "scrobble_queue" ("id" SERIAL NOT NULL, "recordingMbid" character varying, "releaseGroupMbid" character varying, "trackId" integer, "artist" character varying NOT NULL, "track" character varying NOT NULL, "album" character varying, "durationMs" integer, "playedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "source" character varying NOT NULL, "targets" text NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "lastError" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, CONSTRAINT "PK_63ce89df0c17c40fef96d7c55b2" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c0066088d4849e34b474acc19" ON "scrobble_queue" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8a227c0ab7e5bf83b1c0845db" ON "scrobble_queue" ("playedAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "session" ("expiredAt" bigint NOT NULL, "id" character varying(255) NOT NULL, "json" text NOT NULL, "destroyedAt" TIMESTAMP, CONSTRAINT "PK_f55da76ac1c3ac420f444d2ff11" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28c5d1d16da7908c97c9bc2f74" ON "session" ("expiredAt") `
    );
    await queryRunner.query(
      `CREATE TABLE "star" ("id" SERIAL NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" integer, "trackId" integer, "mediaId" integer, CONSTRAINT "UQ_star_user_track_media" UNIQUE ("userId", "trackId", "mediaId"), CONSTRAINT "PK_e0a31656542918b9e028c3b9f5f" PRIMARY KEY ("id"))`
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
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD CONSTRAINT "FK_356721a49f145aa439c16e6b999" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD CONSTRAINT "FK_5c8af2d0e83b3be6d250eccc19d" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "issue_comment" ADD CONSTRAINT "FK_707b033c2d0653f75213614789d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "issue_comment" ADD CONSTRAINT "FK_180710fead1c94ca499c57a7d42" FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" ADD CONSTRAINT "FK_276e20d053f3cff1645803c95d8" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" ADD CONSTRAINT "FK_10b17b49d1ee77e7184216001e0" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" ADD CONSTRAINT "FK_da88a1019c850d1a7b143ca02e5" FOREIGN KEY ("modifiedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "track" ADD CONSTRAINT "FK_30e3a3e4a7ceaf5127fb35322ff" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "track_request" ADD CONSTRAINT "FK_d6b4a4b7ba424a22ab38e4a3e5c" FOREIGN KEY ("requestId") REFERENCES "media_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "track_request" ADD CONSTRAINT "FK_14760a9c6609e37fe633ddd02c4" FOREIGN KEY ("trackId") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD CONSTRAINT "FK_a1aa713f41c99e9d10c48da75a0" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD CONSTRAINT "FK_6997bee94720f1ecb7f31137095" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD CONSTRAINT "FK_f4fc4efa14c3ba2b29c4525fa15" FOREIGN KEY ("modifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "FK_ae34e6b153a90672eb9dc4857d7" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "FK_6641da8d831b93dfcb429f8b8bc" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "linked_account" ADD CONSTRAINT "FK_db4c4bfb7727d438b35364fbd02" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "user_push_subscription" ADD CONSTRAINT "FK_03f7958328e311761b0de675fbe" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "app_password" ADD CONSTRAINT "FK_ef734727840f2a6cd78c293378f" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "import_job" ADD CONSTRAINT "FK_5128ba16a1effbbd06740606fb7" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "playlist_item" ADD CONSTRAINT "FK_9b9b229772d88966e7d9959d907" FOREIGN KEY ("playlistId") REFERENCES "playlist"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "playlist_item" ADD CONSTRAINT "FK_775b9c3be0f7e2241229c8fff7f" FOREIGN KEY ("trackId") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "playlist" ADD CONSTRAINT "FK_92ca9b9b5394093adb6e5f55c4b" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "scrobble_queue" ADD CONSTRAINT "FK_2c0066088d4849e34b474acc19e" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "star" ADD CONSTRAINT "FK_2018c9deccb66c6db30a1ddbd1d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "star" ADD CONSTRAINT "FK_b0fe75bc5cb0c9c7369f6499c68" FOREIGN KEY ("trackId") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "star" ADD CONSTRAINT "FK_1be6158f58d57dfcfb6507745d2" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "star" DROP CONSTRAINT "FK_1be6158f58d57dfcfb6507745d2"`
    );
    await queryRunner.query(
      `ALTER TABLE "star" DROP CONSTRAINT "FK_b0fe75bc5cb0c9c7369f6499c68"`
    );
    await queryRunner.query(
      `ALTER TABLE "star" DROP CONSTRAINT "FK_2018c9deccb66c6db30a1ddbd1d"`
    );
    await queryRunner.query(
      `ALTER TABLE "scrobble_queue" DROP CONSTRAINT "FK_2c0066088d4849e34b474acc19e"`
    );
    await queryRunner.query(
      `ALTER TABLE "playlist" DROP CONSTRAINT "FK_92ca9b9b5394093adb6e5f55c4b"`
    );
    await queryRunner.query(
      `ALTER TABLE "playlist_item" DROP CONSTRAINT "FK_775b9c3be0f7e2241229c8fff7f"`
    );
    await queryRunner.query(
      `ALTER TABLE "playlist_item" DROP CONSTRAINT "FK_9b9b229772d88966e7d9959d907"`
    );
    await queryRunner.query(
      `ALTER TABLE "import_job" DROP CONSTRAINT "FK_5128ba16a1effbbd06740606fb7"`
    );
    await queryRunner.query(
      `ALTER TABLE "app_password" DROP CONSTRAINT "FK_ef734727840f2a6cd78c293378f"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_push_subscription" DROP CONSTRAINT "FK_03f7958328e311761b0de675fbe"`
    );
    await queryRunner.query(
      `ALTER TABLE "linked_account" DROP CONSTRAINT "FK_db4c4bfb7727d438b35364fbd02"`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" DROP CONSTRAINT "FK_6641da8d831b93dfcb429f8b8bc"`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" DROP CONSTRAINT "FK_ae34e6b153a90672eb9dc4857d7"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP CONSTRAINT "FK_f4fc4efa14c3ba2b29c4525fa15"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP CONSTRAINT "FK_6997bee94720f1ecb7f31137095"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP CONSTRAINT "FK_a1aa713f41c99e9d10c48da75a0"`
    );
    await queryRunner.query(
      `ALTER TABLE "track_request" DROP CONSTRAINT "FK_14760a9c6609e37fe633ddd02c4"`
    );
    await queryRunner.query(
      `ALTER TABLE "track_request" DROP CONSTRAINT "FK_d6b4a4b7ba424a22ab38e4a3e5c"`
    );
    await queryRunner.query(
      `ALTER TABLE "track" DROP CONSTRAINT "FK_30e3a3e4a7ceaf5127fb35322ff"`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" DROP CONSTRAINT "FK_da88a1019c850d1a7b143ca02e5"`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" DROP CONSTRAINT "FK_10b17b49d1ee77e7184216001e0"`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" DROP CONSTRAINT "FK_276e20d053f3cff1645803c95d8"`
    );
    await queryRunner.query(
      `ALTER TABLE "issue_comment" DROP CONSTRAINT "FK_180710fead1c94ca499c57a7d42"`
    );
    await queryRunner.query(
      `ALTER TABLE "issue_comment" DROP CONSTRAINT "FK_707b033c2d0653f75213614789d"`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP CONSTRAINT "FK_5c8af2d0e83b3be6d250eccc19d"`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP CONSTRAINT "FK_356721a49f145aa439c16e6b999"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1be6158f58d57dfcfb6507745d"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0fe75bc5cb0c9c7369f6499c6"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2018c9deccb66c6db30a1ddbd1"`
    );
    await queryRunner.query(`DROP TABLE "star"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28c5d1d16da7908c97c9bc2f74"`
    );
    await queryRunner.query(`DROP TABLE "session"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8a227c0ab7e5bf83b1c0845db"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2c0066088d4849e34b474acc19"`
    );
    await queryRunner.query(`DROP TABLE "scrobble_queue"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92ca9b9b5394093adb6e5f55c4"`
    );
    await queryRunner.query(`DROP TABLE "playlist"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_775b9c3be0f7e2241229c8fff7"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b9b229772d88966e7d9959d90"`
    );
    await queryRunner.query(`DROP TABLE "playlist_item"`);
    await queryRunner.query(`DROP TABLE "override_rule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5128ba16a1effbbd06740606fb"`
    );
    await queryRunner.query(`DROP TABLE "import_job"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1642f51b7417f5ddffd32c7134"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b966c85d9a41aeb737fea8672d"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a4e21f37e181fc529203d258a"`
    );
    await queryRunner.query(`DROP TABLE "event"`);
    await queryRunner.query(`DROP TABLE "discover_slider"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ebca0c0b75dd511211f8a9c1f"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef734727840f2a6cd78c293378"`
    );
    await queryRunner.query(`DROP TABLE "app_password"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_03f7958328e311761b0de675fb"`
    );
    await queryRunner.query(`DROP TABLE "user_push_subscription"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db4c4bfb7727d438b35364fbd0"`
    );
    await queryRunner.query(`DROP TABLE "linked_account"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6641da8d831b93dfcb429f8b8b"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae34e6b153a90672eb9dc4857d"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cbb73271b5059b373cf1ea0e18"`
    );
    await queryRunner.query(`DROP TABLE "watchlist"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0d04ac96042a170a457c6f11ae"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c730c2d67f271a372c39a07b7e"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fadf745b3868369182773ffd89"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e2a99bfef02f8f080442ba4d2"`
    );
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_request_media_scope_status"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f4fc4efa14c3ba2b29c4525fa1"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6997bee94720f1ecb7f3113709"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a1aa713f41c99e9d10c48da75a"`
    );
    await queryRunner.query(`DROP TABLE "media_request"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14760a9c6609e37fe633ddd02c"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6b4a4b7ba424a22ab38e4a3e5"`
    );
    await queryRunner.query(`DROP TABLE "track_request"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dcf30430ba207bf1887bd384a6"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47c7f19876b39cf3bf3db36f6b"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30e3a3e4a7ceaf5127fb35322f"`
    );
    await queryRunner.query(`DROP TABLE "track"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da88a1019c850d1a7b143ca02e"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10b17b49d1ee77e7184216001e"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_276e20d053f3cff1645803c95d"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53d04c07c3f4f54eae372ed665"`
    );
    await queryRunner.query(`DROP TABLE "issue"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_180710fead1c94ca499c57a7d4"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_707b033c2d0653f75213614789"`
    );
    await queryRunner.query(`DROP TABLE "issue_comment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_356721a49f145aa439c16e6b99"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_526a98c8311a9b1b83189eb760"`
    );
    await queryRunner.query(`DROP TABLE "blocklist"`);
  }
}
