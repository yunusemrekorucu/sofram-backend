import {
  // common
  Module,
} from '@nestjs/common';

import { UsersController } from './users.controller';

import { UsersService } from './users.service';
import { RelationalUserPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { FilesModule } from '../files/files.module';
import { AddressesModule } from '../addresses/addresses.module';
import { SessionModule } from '../session/session.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';

const infrastructurePersistenceModule = RelationalUserPersistenceModule;

@Module({
  imports: [
    // import modules, etc.
    infrastructurePersistenceModule,
    FilesModule,
    AddressesModule,
    SessionModule,
    KitchensModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, infrastructurePersistenceModule],
})
export class UsersModule {}
