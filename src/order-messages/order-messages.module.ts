import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { KitchensModule } from '../kitchens/kitchens.module';
import { OrdersModule } from '../orders/orders.module';
import { CookOrderMessagesController } from './cook-order-messages.controller';
import { RelationalOrderMessagePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderMessagesController } from './order-messages.controller';
import { OrderMessagesService } from './order-messages.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderMessagePersistenceModule,
    OrdersModule,
    KitchensModule,
  ],
  controllers: [OrderMessagesController, CookOrderMessagesController],
  providers: [OrderMessagesService],
  exports: [OrderMessagesService],
})
export class OrderMessagesModule {}
