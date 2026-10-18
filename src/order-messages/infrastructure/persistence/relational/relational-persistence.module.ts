import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderMessageRepository } from '../order-message.repository';
import { OrderMessageEntity } from './entities/order-message.entity';
import { OrderMessageRelationalRepository } from './repositories/order-message.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OrderMessageEntity])],
  providers: [
    {
      provide: OrderMessageRepository,
      useClass: OrderMessageRelationalRepository,
    },
  ],
  exports: [OrderMessageRepository],
})
export class RelationalOrderMessagePersistenceModule {}
