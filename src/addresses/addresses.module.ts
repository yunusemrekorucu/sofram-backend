import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { RelationalAddressPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalAddressPersistenceModule,
  ],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService, RelationalAddressPersistenceModule],
})
export class AddressesModule {}
