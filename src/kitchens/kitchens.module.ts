import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { FilesModule } from '../files/files.module';
import { RelationalKitchenPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { KitchensController } from './kitchens.controller';
import { KitchensService } from './kitchens.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalKitchenPersistenceModule,
    AddressesModule,
    FilesModule,
  ],
  controllers: [KitchensController],
  providers: [KitchensService],
  exports: [KitchensService, RelationalKitchenPersistenceModule],
})
export class KitchensModule {}
