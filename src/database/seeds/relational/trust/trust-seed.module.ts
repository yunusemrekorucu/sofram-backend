import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoriteEntity } from '../../../../favorites/infrastructure/persistence/relational/entities/favorite.entity';
import { FileEntity } from '../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderIssueEntity } from '../../../../order-issues/infrastructure/persistence/relational/entities/order-issue.entity';
import { OrderMessageEntity } from '../../../../order-messages/infrastructure/persistence/relational/entities/order-message.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { ReviewEntity } from '../../../../reviews/infrastructure/persistence/relational/entities/review.entity';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { OrderSeedModule } from '../order/order-seed.module';
import { TrustSeedService } from './trust-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      KitchenEntity,
      OrderEntity,
      ReviewEntity,
      FavoriteEntity,
      OrderMessageEntity,
      OrderIssueEntity,
      FileEntity,
    ]),
    OrderSeedModule,
  ],
  providers: [TrustSeedService],
  exports: [TrustSeedService],
})
export class TrustSeedModule {}
