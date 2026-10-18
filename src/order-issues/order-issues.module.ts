import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MailModule } from '../mail/mail.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminOrderIssuesController } from './admin-order-issues.controller';
import { RelationalOrderIssuePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderIssuesController } from './order-issues.controller';
import { OrderIssuesService } from './order-issues.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderIssuePersistenceModule,
    OrdersModule,
    PaymentsModule,
    MailModule,
    FilesModule,
  ],
  controllers: [OrderIssuesController, AdminOrderIssuesController],
  providers: [OrderIssuesService],
  exports: [RelationalOrderIssuePersistenceModule],
})
export class OrderIssuesModule {}
