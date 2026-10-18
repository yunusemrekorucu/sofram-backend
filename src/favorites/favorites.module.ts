import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { KitchensModule } from '../kitchens/kitchens.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { RelationalFavoritePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalFavoritePersistenceModule,
    KitchensModule,
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
