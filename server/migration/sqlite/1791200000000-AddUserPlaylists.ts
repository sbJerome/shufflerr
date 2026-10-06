import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPlaylists1791200000000 implements MigrationInterface {
  name = 'AddUserPlaylists1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_playlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "ownerId" integer, CONSTRAINT "FK_user_playlist_owner" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_playlist_owner" ON "user_playlist" ("ownerId") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_playlist_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbid" varchar NOT NULL, "mediaType" varchar NOT NULL, "title" varchar NOT NULL DEFAULT (''), "artistName" varchar NOT NULL DEFAULT (''), "position" integer NOT NULL DEFAULT (0), "playlistId" integer, CONSTRAINT "FK_user_playlist_item_playlist" FOREIGN KEY ("playlistId") REFERENCES "user_playlist" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_playlist_item_playlist" ON "user_playlist_item" ("playlistId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_playlist_item_mbid" ON "user_playlist_item" ("mbid") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_user_playlist_item_mbid"`);
    await queryRunner.query(`DROP INDEX "IDX_user_playlist_item_playlist"`);
    await queryRunner.query(`DROP TABLE "user_playlist_item"`);
    await queryRunner.query(`DROP INDEX "IDX_user_playlist_owner"`);
    await queryRunner.query(`DROP TABLE "user_playlist"`);
  }
}
