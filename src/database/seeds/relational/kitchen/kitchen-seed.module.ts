import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { KitchenSeedService } from './kitchen-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      KitchenEntity,
      ProductEntity,
      CategoryEntity,
    ]),
  ],
  providers: [KitchenSeedService],
  exports: [KitchenSeedService],
})
export class KitchenSeedModule {}
