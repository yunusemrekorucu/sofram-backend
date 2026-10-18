import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrust1792291566694 implements MigrationInterface {
  name = 'CreateTrust1792291566694';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "review" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "kitchenId" uuid NOT NULL, "authorId" integer NOT NULL, "rating" smallint NOT NULL, "taste" smallint, "portion" smallint, "packaging" smallint, "timing" smallint, "tags" text NOT NULL DEFAULT '', "comment" character varying(500), "photos" jsonb NOT NULL DEFAULT '[]', "reply" character varying(300), "repliedAt" TIMESTAMP WITH TIME ZONE, "isHidden" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "REL_31db76b2d6dfe81d69e27b66c2" UNIQUE ("orderId"), CONSTRAINT "PK_2e4299a343a81574217255c00ca" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e758e3895b930ccf269f30c41" ON "review" ("authorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46efe51ab357b766874be6e915" ON "review" ("kitchenId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "review_report" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reviewId" uuid NOT NULL, "reporterId" integer NOT NULL, "reason" character varying NOT NULL, "note" character varying(300), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_bd50c50571dcf8924a32c5d3e82" UNIQUE ("reviewId", "reporterId"), CONSTRAINT "PK_f313476ee27a2c314c816242291" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_message" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "senderId" integer NOT NULL, "senderRole" character varying NOT NULL, "body" character varying(500) NOT NULL, "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ca42c8faf6aebd40048957e3710" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c8bb14cb720936ffdcd5f6b59" ON "order_message" ("senderId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22f4c94543562e2f63b7eb4547" ON "order_message" ("orderId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "order_issue" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "reporterId" integer NOT NULL, "category" character varying NOT NULL, "description" character varying(1000) NOT NULL, "photos" jsonb NOT NULL DEFAULT '[]', "requestedResolution" character varying NOT NULL, "status" character varying NOT NULL, "refundKurus" integer, "adminNote" character varying(500), "resolvedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f2b1f6b1ca98ef908a590527c3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_order_issue_open_order" ON "order_issue" ("orderId") WHERE "status" = 'open'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d53f576a06072236a6808b7cf" ON "order_issue" ("orderId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "favorite" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "kitchenId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_57f03f144710915a0243e651360" UNIQUE ("userId", "kitchenId"), CONSTRAINT "PK_495675cec4fb09666704e4f610f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen" ADD "ratingAvg" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "kitchen" ADD "ratingCount" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD "customerLastReadAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD "cookLastReadAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment" ADD "refundedKurus" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_31db76b2d6dfe81d69e27b66c20" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_a1d31fe9b179dafbf4ae711c005" FOREIGN KEY ("kitchenId") REFERENCES "kitchen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_1e758e3895b930ccf269f30c415" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_report" ADD CONSTRAINT "FK_403d8d00a4706d4cf77def37b0e" FOREIGN KEY ("reviewId") REFERENCES "review"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_report" ADD CONSTRAINT "FK_69e5d130ca1b18011ffc8fc6286" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_message" ADD CONSTRAINT "FK_ed49fcbf61b51e2e9087e44abee" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_message" ADD CONSTRAINT "FK_6c8bb14cb720936ffdcd5f6b599" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_issue" ADD CONSTRAINT "FK_2a00aea4b859879094119c785bf" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_issue" ADD CONSTRAINT "FK_489414df28be5f89e5031812fb6" FOREIGN KEY ("reporterId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite" ADD CONSTRAINT "FK_83b775fdebbe24c29b2b5831f2d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite" ADD CONSTRAINT "FK_48ab030b9844b736426771693b3" FOREIGN KEY ("kitchenId") REFERENCES "kitchen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // Hand-added: payments refunded before Faz 4 gave everything back.
    await queryRunner.query(
      `UPDATE "payment" SET "refundedKurus" = "amountKurus" WHERE "status" = 'refunded'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "favorite" DROP CONSTRAINT "FK_48ab030b9844b736426771693b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "favorite" DROP CONSTRAINT "FK_83b775fdebbe24c29b2b5831f2d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_issue" DROP CONSTRAINT "FK_489414df28be5f89e5031812fb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_issue" DROP CONSTRAINT "FK_2a00aea4b859879094119c785bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_message" DROP CONSTRAINT "FK_6c8bb14cb720936ffdcd5f6b599"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_message" DROP CONSTRAINT "FK_ed49fcbf61b51e2e9087e44abee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_report" DROP CONSTRAINT "FK_69e5d130ca1b18011ffc8fc6286"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_report" DROP CONSTRAINT "FK_403d8d00a4706d4cf77def37b0e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_1e758e3895b930ccf269f30c415"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_a1d31fe9b179dafbf4ae711c005"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_31db76b2d6dfe81d69e27b66c20"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment" DROP COLUMN "refundedKurus"`,
    );
    await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "cookLastReadAt"`);
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN "customerLastReadAt"`,
    );
    await queryRunner.query(`ALTER TABLE "kitchen" DROP COLUMN "ratingCount"`);
    await queryRunner.query(`ALTER TABLE "kitchen" DROP COLUMN "ratingAvg"`);
    await queryRunner.query(`DROP TABLE "favorite"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d53f576a06072236a6808b7cf"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_order_issue_open_order"`);
    await queryRunner.query(`DROP TABLE "order_issue"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_22f4c94543562e2f63b7eb4547"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c8bb14cb720936ffdcd5f6b59"`,
    );
    await queryRunner.query(`DROP TABLE "order_message"`);
    await queryRunner.query(`DROP TABLE "review_report"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46efe51ab357b766874be6e915"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e758e3895b930ccf269f30c41"`,
    );
    await queryRunner.query(`DROP TABLE "review"`);
  }
}
