import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { RelationalOrderIssuePersistenceModule } from '../order-issues/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalOrderMessagePersistenceModule } from '../order-messages/infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { RelationalReviewPersistenceModule } from '../reviews/infrastructure/persistence/relational/relational-persistence.module';
import { CookOrdersController } from './cook-orders.controller';
import { CookOrdersService } from './cook-orders.service';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderTrustService } from './order-trust.service';
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
    // Read-only: the review, issue and chat state shown on order screens.
    RelationalReviewPersistenceModule,
    RelationalOrderIssuePersistenceModule,
    RelationalOrderMessagePersistenceModule,
  ],
  controllers: [OrdersController, CookOrdersController],
  providers: [
    OrdersService,
    CookOrdersService,
    OrderLifecycleService,
    OrderTrustService,
    OrdersExpiryTask,
  ],
  exports: [OrdersService, RelationalOrderPersistenceModule],
})
export class OrdersModule {}
