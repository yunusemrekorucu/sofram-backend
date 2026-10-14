import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserAllergenPreferences1792020589065 implements MigrationInterface {
  name = 'UserAllergenPreferences1792020589065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "allergenPreferences" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "allergenPreferences"`,
    );
  }
}
