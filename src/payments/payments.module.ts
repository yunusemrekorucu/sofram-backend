import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsService } from './payments.service';
import { paymentProviderProvider } from './provider/payment-provider.provider';

@Module({
  imports: [
    // do not remove this comment
    RelationalPaymentPersistenceModule,
  ],
  providers: [PaymentsService, paymentProviderProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
