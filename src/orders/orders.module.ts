import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { CookOrdersController } from './cook-orders.controller';
import { CookOrdersService } from './cook-orders.service';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersExpiryTask } from './orders-expiry.task';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderPersistenceModule,
    PaymentsModule,
    KitchensModule,
    ProductsModule,
    AddressesModule,
  ],
  controllers: [OrdersController, CookOrdersController],
  providers: [
    OrdersService,
    CookOrdersService,
    OrderLifecycleService,
    OrdersExpiryTask,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
