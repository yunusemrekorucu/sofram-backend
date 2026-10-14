import { Module } from '@nestjs/common';
import { KitchenRepository } from '../kitchen.repository';
import { KitchenRelationalRepository } from './repositories/kitchen.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KitchenEntity } from './entities/kitchen.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KitchenEntity])],
  providers: [
    {
      provide: KitchenRepository,
      useClass: KitchenRelationalRepository,
    },
  ],
  exports: [KitchenRepository],
})
export class RelationalKitchenPersistenceModule {}
