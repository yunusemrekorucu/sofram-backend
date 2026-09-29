import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPhoneAuth1790721526783 implements MigrationInterface {
  name = 'UserPhoneAuth1790721526783';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "marketingConsent" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "kvkkAcceptedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "phoneNumber" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_f2578043e491921209f5dadd080" UNIQUE ("phoneNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "UQ_f2578043e491921209f5dadd080"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "phoneNumber"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "kvkkAcceptedAt"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "marketingConsent"`,
    );
  }
}
