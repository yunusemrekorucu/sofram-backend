import { MigrationInterface, QueryRunner } from 'typeorm';

export class KitchenMinOrder1792284078104 implements MigrationInterface {
  name = 'KitchenMinOrder1792284078104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kitchen" ADD "minOrderKurus" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kitchen" DROP COLUMN "minOrderKurus"`,
    );
  }
}
