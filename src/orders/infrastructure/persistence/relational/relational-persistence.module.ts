import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderRepository } from '../order.repository';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderRequestEntity } from './entities/order-request.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderRelationalRepository } from './repositories/order.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderRequestEntity,
    ]),
  ],
  providers: [
    {
      provide: OrderRepository,
      useClass: OrderRelationalRepository,
    },
  ],
  exports: [OrderRepository],
})
export class RelationalOrderPersistenceModule {}
