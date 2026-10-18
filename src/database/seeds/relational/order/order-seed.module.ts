import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressEntity } from '../../../../addresses/infrastructure/persistence/relational/entities/address.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderItemEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { PaymentEntity } from '../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { OrderSeedService } from './order-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      AddressEntity,
      KitchenEntity,
      ProductEntity,
      OrderEntity,
      OrderItemEntity,
      PaymentEntity,
    ]),
  ],
  providers: [OrderSeedService],
  exports: [OrderSeedService],
})
export class OrderSeedModule {}
