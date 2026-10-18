import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderPersistenceModule,
  ],
  exports: [RelationalOrderPersistenceModule],
})
export class OrdersModule {}
