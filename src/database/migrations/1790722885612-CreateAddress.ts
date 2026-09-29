import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAddress1790722885612 implements MigrationInterface {
  name = 'CreateAddress1790722885612';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "address" ("isDefault" boolean NOT NULL DEFAULT false, "longitude" double precision NOT NULL, "latitude" double precision NOT NULL, "directions" character varying, "apartmentNo" character varying, "floor" character varying, "buildingNo" character varying, "neighborhood" character varying NOT NULL, "district" character varying NOT NULL, "fullAddress" character varying NOT NULL, "title" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer NOT NULL, CONSTRAINT "PK_d92de1f82754668b5f5f5dd4fd5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d25f1ea79e282cc8a42bd616aa" ON "address" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "address" ADD CONSTRAINT "FK_d25f1ea79e282cc8a42bd616aa3" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "address" DROP CONSTRAINT "FK_d25f1ea79e282cc8a42bd616aa3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d25f1ea79e282cc8a42bd616aa"`,
    );
    await queryRunner.query(`DROP TABLE "address"`);
  }
}
