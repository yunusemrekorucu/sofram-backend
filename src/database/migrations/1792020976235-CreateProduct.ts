import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProduct1792020976235 implements MigrationInterface {
  name = 'CreateProduct1792020976235';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "product" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kitchenId" uuid NOT NULL, "categoryId" uuid NOT NULL, "name" character varying NOT NULL, "description" character varying, "priceKurus" integer NOT NULL, "saleType" character varying NOT NULL, "prepMinutes" integer, "portionsAvailable" integer, "allergens" text NOT NULL DEFAULT '', "dietTags" text NOT NULL DEFAULT '', "photos" jsonb NOT NULL DEFAULT '[]', "isActive" boolean NOT NULL DEFAULT true, "searchText" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_bebc9158e480b949565b4dc7a82" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f411d25806e3bb016389d7c2cf" ON "product" ("kitchenId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "product" ADD CONSTRAINT "FK_f411d25806e3bb016389d7c2cfa" FOREIGN KEY ("kitchenId") REFERENCES "kitchen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "product" ADD CONSTRAINT "FK_ff0c0301a95e517153df97f6812" FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product" DROP CONSTRAINT "FK_ff0c0301a95e517153df97f6812"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product" DROP CONSTRAINT "FK_f411d25806e3bb016389d7c2cfa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f411d25806e3bb016389d7c2cf"`,
    );
    await queryRunner.query(`DROP TABLE "product"`);
  }
}
