import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KitchenEntity } from '../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { UsersModule } from '../users/users.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryRepository } from './discovery.repository';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KitchenEntity, ProductEntity]),
    UsersModule,
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DiscoveryRepository],
})
export class DiscoveryModule {}
