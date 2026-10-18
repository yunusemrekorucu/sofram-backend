import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { In, Repository } from 'typeorm';
import { FileEntity } from '../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { FavoriteEntity } from '../../../../favorites/infrastructure/persistence/relational/entities/favorite.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderIssueEntity } from '../../../../order-issues/infrastructure/persistence/relational/entities/order-issue.entity';
import { OrderMessageEntity } from '../../../../order-messages/infrastructure/persistence/relational/entities/order-message.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { Fulfillment, OrderStatus } from '../../../../orders/order.enums';
import { ReviewEntity } from '../../../../reviews/infrastructure/persistence/relational/entities/review.entity';
import { ratingGroupsOf } from '../../../../reviews/infrastructure/persistence/relational/repositories/review.repository';
import { ratingSummary } from '../../../../trust/trust-rules';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
  MessageSide,
  ReviewTag,
} from '../../../../trust/trust.enums';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { OrderSeedService } from '../order/order-seed.service';

const COOK_PHONES = ['+905550000101', '+905550000102', '+905550000103'];
const CUSTOMER_PHONE = '+905550000201';
const MINUTE_MS = 60_000;

// 1×1 PNG, served by the local file driver like an upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PHOTO_NAME = 'seed-review.png';

/**
 * Development data only, on top of the order seed: reviews on completed
 * orders (one answered by the cook, one with a photo), two favorites, a
 * four-message chat on the order that is on its way, one open issue, and
 * the seed kitchens' ratings recomputed. Runs once (skips when the seed
 * customer has a review).
 */
@Injectable()
export class TrustSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(ReviewEntity)
    private readonly reviews: Repository<ReviewEntity>,
    @InjectRepository(FavoriteEntity)
    private readonly favorites: Repository<FavoriteEntity>,
    @InjectRepository(OrderMessageEntity)
    private readonly messages: Repository<OrderMessageEntity>,
    @InjectRepository(OrderIssueEntity)
    private readonly issues: Repository<OrderIssueEntity>,
    @InjectRepository(FileEntity)
    private readonly files: Repository<FileEntity>,
    private readonly orderSeed: OrderSeedService,
  ) {}

  async run() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const customer = await this.users.findOne({
      where: { phoneNumber: CUSTOMER_PHONE },
    });
    const cooks = await this.users.find({
      where: { phoneNumber: In(COOK_PHONES) },
    });
    const kitchens = await this.kitchens.find({
      where: { ownerId: In(cooks.map((cook) => cook.id)) },
    });
    const byPhone = (phone: string) => {
      const cook = cooks.find((user) => user.phoneNumber === phone);
      return kitchens.find((kitchen) => kitchen.ownerId === cook?.id);
    };
    const [ayse, nuran, hatice] = COOK_PHONES.map(byPhone);

    if (
      !customer ||
      !ayse ||
      !nuran ||
      !hatice ||
      (await this.reviews.exists({
        where: { authorId: customer.id },
        withDeleted: true,
      }))
    ) {
      return;
    }

    const completed = await this.orders.findOne({
      where: {
        kitchenId: ayse.id,
        customerId: customer.id,
        status: OrderStatus.completed,
      },
    });
    const onTheWay = await this.orders.findOne({
      where: {
        kitchenId: ayse.id,
        customerId: customer.id,
        status: OrderStatus.onTheWay,
      },
    });

    if (!completed || !onTheWay) {
      return;
    }

    // Yesterday at Nuran's (reviewed with a photo, issue open) and three hours
    // ago at Hatice's (left unreviewed for the review reminder).
    const sarma = await this.orderSeed.addOrder(
      {
        status: OrderStatus.completed,
        fulfillment: Fulfillment.pickup,
        items: [['Yaprak sarma', 2]],
        minutesAgo: 26 * 60,
      },
      nuran,
      customer,
      await this.orderSeed.menuOf(nuran),
    );
    await this.orderSeed.addOrder(
      {
        status: OrderStatus.completed,
        fulfillment: Fulfillment.delivery,
        items: [['Su böreği', 1]],
        minutesAgo: 3 * 60,
      },
      hatice,
      customer,
      await this.orderSeed.menuOf(hatice),
    );

    const photo = await this.photo();

    await this.reviews.save([
      this.reviews.create({
        orderId: completed.id,
        kitchenId: ayse.id,
        authorId: customer.id,
        rating: 5,
        taste: 5,
        portion: 5,
        packaging: null,
        timing: 4,
        tags: [ReviewTag.homemade, ReviewTag.generousPortion],
        comment: 'Annemin karnıyarığı gibi, porsiyon da doyurucu.',
        photos: [],
        reply: 'Afiyet olsun Deniz Hanım, yine bekleriz!',
        repliedAt: new Date(),
        isHidden: false,
      }),
      this.reviews.create({
        orderId: sarma.id,
        kitchenId: nuran.id,
        authorId: customer.id,
        rating: 4,
        taste: 5,
        portion: 3,
        packaging: 4,
        timing: null,
        tags: [ReviewTag.wellPackaged],
        comment: 'Sarmalar çok lezzetliydi, bir porsiyon eksik geldi.',
        photos: [{ id: photo.id, path: photo.path }],
        reply: null,
        repliedAt: null,
        isHidden: false,
      }),
    ]);

    await this.favorites.save([
      this.favorites.create({ userId: customer.id, kitchenId: ayse.id }),
      this.favorites.create({ userId: customer.id, kitchenId: hatice.id }),
    ]);

    await this.chat(onTheWay, customer, ayse.ownerId);

    await this.issues.save(
      this.issues.create({
        orderId: sarma.id,
        reporterId: customer.id,
        category: IssueCategory.missingItem,
        description: 'Siparişte 2 porsiyon sarma vardı, 1 porsiyon geldi.',
        photos: [],
        requestedResolution: IssueResolution.refundPartial,
        status: IssueStatus.open,
        refundKurus: null,
        adminNote: null,
        resolvedAt: null,
      }),
    );

    for (const kitchen of [ayse, nuran, hatice]) {
      const { ratingAvg, ratingCount } = ratingSummary(
        await ratingGroupsOf(this.reviews.manager, kitchen.id),
      );
      await this.kitchens.update(
        { id: kitchen.id },
        { ratingAvg, ratingCount },
      );
    }
  }

  /** Four messages; the cook's last one is still unread by the customer. */
  private async chat(
    order: OrderEntity,
    customer: UserEntity,
    cookId: number,
  ): Promise<void> {
    const start = Date.now() - 20 * MINUTE_MS;
    const lines: [MessageSide, string][] = [
      [
        MessageSide.customer,
        'Merhaba, zil bozuk; gelince buradan yazar mısınız?',
      ],
      [MessageSide.cook, 'Tabii, yola çıktım, 10 dakikaya oradayım.'],
      [MessageSide.customer, 'Teşekkürler, aşağı iniyorum.'],
      [MessageSide.cook, 'Kapıdayım.'],
    ];

    await this.messages.save(
      lines.map(([side, body], index) =>
        this.messages.create({
          orderId: order.id,
          senderId: side === MessageSide.customer ? customer.id : cookId,
          senderRole: side,
          body,
          createdAt: new Date(start + index * 5 * MINUTE_MS),
        }),
      ),
    );

    // Both read up to the third message.
    const readAt = new Date(start + 2 * 5 * MINUTE_MS + MINUTE_MS);
    await this.orders.update(
      { id: order.id },
      { customerLastReadAt: readAt, cookLastReadAt: readAt },
    );
  }

  /** A real file under ./files, registered like an upload. */
  private async photo(): Promise<FileEntity> {
    const directory = path.join(process.cwd(), 'files');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, PHOTO_NAME), PNG);

    return this.files.save(
      this.files.create({
        path: `/${process.env.API_PREFIX ?? 'api'}/v1/files/${PHOTO_NAME}`,
      }),
    );
  }
}
