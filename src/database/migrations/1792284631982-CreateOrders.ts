import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrders1792284631982 implements MigrationInterface {
  name = 'CreateOrders1792284631982';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_item" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "productId" uuid NOT NULL, "position" integer NOT NULL, "name" character varying NOT NULL, "unitPriceKurus" integer NOT NULL, "saleType" character varying NOT NULL, "prepMinutes" integer, "photo" jsonb, "quantity" integer NOT NULL, "note" character varying(140), CONSTRAINT "PK_d01158fe15b1ead5c26fd7f4e90" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_646bf9ece6f45dbe41c203e06e" ON "order_item" ("orderId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "order" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(6) NOT NULL, "customerId" integer NOT NULL, "kitchenId" uuid NOT NULL, "status" character varying NOT NULL, "fulfillment" character varying NOT NULL, "deliveryAddress" jsonb, "distanceKm" double precision, "note" character varying(300), "subtotalKurus" integer NOT NULL, "deliveryFeeKurus" integer NOT NULL, "serviceFeeKurus" integer NOT NULL, "totalKurus" integer NOT NULL, "pickupCode" character(4), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "estimatedReadyAt" TIMESTAMP WITH TIME ZONE, "acceptedAt" TIMESTAMP WITH TIME ZONE, "preparingAt" TIMESTAMP WITH TIME ZONE, "readyAt" TIMESTAMP WITH TIME ZONE, "onTheWayAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, "cancelledBy" character varying, "reason" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_729b3eea7ce540930dbb7069498" UNIQUE ("code"), CONSTRAINT "PK_1031171c13130102495201e3e20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_002bbbfa706d8fe9ace86ac57d" ON "order" ("customerId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4fffc1ab7a679aaa17f5bb471c" ON "order" ("kitchenId", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "provider" character varying NOT NULL, "providerRef" character varying NOT NULL, "amountKurus" integer NOT NULL, "status" character varying NOT NULL, "paidAt" TIMESTAMP WITH TIME ZONE, "refundedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_d09d285fe1645cd2f0db811e29" UNIQUE ("orderId"), CONSTRAINT "PK_fcaec7df5adf9cac408c686b2ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" uuid NOT NULL, "customerId" integer NOT NULL, "orderId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a7f11792ec83e191a5062356c30" UNIQUE ("customerId", "key"), CONSTRAINT "PK_787e7fd11e2728d4b2de2c94e80" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97ecc7ccf9d8d4a66eb08c3849" ON "order_request" ("createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "order_item" ADD CONSTRAINT "FK_646bf9ece6f45dbe41c203e06e0" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_item" ADD CONSTRAINT "FK_904370c093ceea4369659a3c810" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "FK_124456e637cca7a415897dce659" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "FK_ec7e718473542e0aa07a5b93380" FOREIGN KEY ("kitchenId") REFERENCES "kitchen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment" ADD CONSTRAINT "FK_d09d285fe1645cd2f0db811e293" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_request" ADD CONSTRAINT "FK_c99c5af0794b7404a4f0c4929f4" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_request" ADD CONSTRAINT "FK_3581d8c3ffc2a4f3a39cfac0560" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_request" DROP CONSTRAINT "FK_3581d8c3ffc2a4f3a39cfac0560"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_request" DROP CONSTRAINT "FK_c99c5af0794b7404a4f0c4929f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment" DROP CONSTRAINT "FK_d09d285fe1645cd2f0db811e293"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP CONSTRAINT "FK_ec7e718473542e0aa07a5b93380"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP CONSTRAINT "FK_124456e637cca7a415897dce659"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_item" DROP CONSTRAINT "FK_904370c093ceea4369659a3c810"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_item" DROP CONSTRAINT "FK_646bf9ece6f45dbe41c203e06e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97ecc7ccf9d8d4a66eb08c3849"`,
    );
    await queryRunner.query(`DROP TABLE "order_request"`);
    await queryRunner.query(`DROP TABLE "payment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fffc1ab7a679aaa17f5bb471c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_002bbbfa706d8fe9ace86ac57d"`,
    );
    await queryRunner.query(`DROP TABLE "order"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_646bf9ece6f45dbe41c203e06e"`,
    );
    await queryRunner.query(`DROP TABLE "order_item"`);
  }
}
