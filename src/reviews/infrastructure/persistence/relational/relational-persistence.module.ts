import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewRepository } from '../review.repository';
import { ReviewReportEntity } from './entities/review-report.entity';
import { ReviewEntity } from './entities/review.entity';
import { ReviewRelationalRepository } from './repositories/review.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ReviewEntity, ReviewReportEntity])],
  providers: [
    {
      provide: ReviewRepository,
      useClass: ReviewRelationalRepository,
    },
  ],
  exports: [ReviewRepository],
})
export class RelationalReviewPersistenceModule {}
