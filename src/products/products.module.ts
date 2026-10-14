import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { FilesModule } from '../files/files.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { RelationalProductPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalProductPersistenceModule,
    KitchensModule,
    CategoriesModule,
    FilesModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService, RelationalProductPersistenceModule],
})
export class ProductsModule {}
