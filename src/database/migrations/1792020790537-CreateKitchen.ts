import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKitchen1792020790537 implements MigrationInterface {
  name = 'CreateKitchen1792020790537';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "kitchen" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ownerId" integer NOT NULL, "name" character varying NOT NULL, "description" character varying, "coverPhoto" jsonb, "fullAddress" character varying NOT NULL, "district" character varying NOT NULL, "neighborhood" character varying NOT NULL, "latitude" double precision NOT NULL, "longitude" double precision NOT NULL, "pickupEnabled" boolean NOT NULL, "deliveryEnabled" boolean NOT NULL, "deliveryTiers" jsonb NOT NULL DEFAULT '[]', "deliveryRadiusKm" double precision, "freeDeliveryMinKurus" integer, "hours" jsonb NOT NULL DEFAULT '[]', "isPaused" boolean NOT NULL DEFAULT false, "isVerified" boolean NOT NULL DEFAULT false, "searchText" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "REL_f158b0ce6b339da9cffe0d9fd9" UNIQUE ("ownerId"), CONSTRAINT "PK_c79a8f2cdbce1ce12d7198fe344" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a38dbf04093e362194c8bd2ac2" ON "kitchen" ("latitude", "longitude") `,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen" ADD CONSTRAINT "FK_f158b0ce6b339da9cffe0d9fd9a" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kitchen" DROP CONSTRAINT "FK_f158b0ce6b339da9cffe0d9fd9a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a38dbf04093e362194c8bd2ac2"`,
    );
    await queryRunner.query(`DROP TABLE "kitchen"`);
  }
}
