import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { CookReviewsController } from './cook-reviews.controller';
import { RelationalReviewPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalReviewPersistenceModule,
    OrdersModule,
    KitchensModule,
    FilesModule,
  ],
  controllers: [
    ReviewsController,
    CookReviewsController,
    AdminReviewsController,
  ],
  providers: [ReviewsService],
  exports: [ReviewsService, RelationalReviewPersistenceModule],
})
export class ReviewsModule {}
