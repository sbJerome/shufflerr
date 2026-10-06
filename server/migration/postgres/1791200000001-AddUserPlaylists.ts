import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPlaylists1791200000001 implements MigrationInterface {
  name = 'AddUserPlaylists1791200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_playlist" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ownerId" integer, CONSTRAINT "PK_user_playlist" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_playlist_owner" ON "user_playlist" ("ownerId") `
    );
    await queryRunner.query(
      `CREATE TABLE "user_playlist_item" ("id" SERIAL NOT NULL, "mbid" character varying NOT NULL, "mediaType" character varying NOT NULL, "title" character varying NOT NULL DEFAULT '', "artistName" character varying NOT NULL DEFAULT '', "position" integer NOT NULL DEFAULT '0', "playlistId" integer, CONSTRAINT "PK_user_playlist_item" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_playlist_item_playlist" ON "user_playlist_item" ("playlistId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_playlist_item_mbid" ON "user_playlist_item" ("mbid") `
    );
    await queryRunner.query(
      `ALTER TABLE "user_playlist" ADD CONSTRAINT "FK_user_playlist_owner" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "user_playlist_item" ADD CONSTRAINT "FK_user_playlist_item_playlist" FOREIGN KEY ("playlistId") REFERENCES "user_playlist"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_playlist_item" DROP CONSTRAINT "FK_user_playlist_item_playlist"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_playlist" DROP CONSTRAINT "FK_user_playlist_owner"`
    );
    await queryRunner.query(`DROP INDEX "IDX_user_playlist_item_mbid"`);
    await queryRunner.query(`DROP INDEX "IDX_user_playlist_item_playlist"`);
    await queryRunner.query(`DROP TABLE "user_playlist_item"`);
    await queryRunner.query(`DROP INDEX "IDX_user_playlist_owner"`);
    await queryRunner.query(`DROP TABLE "user_playlist"`);
  }
}
