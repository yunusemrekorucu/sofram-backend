import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalPaymentPersistenceModule,
  ],
  exports: [RelationalPaymentPersistenceModule],
})
export class PaymentsModule {}
