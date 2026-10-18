import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderIssueRepository } from '../order-issue.repository';
import { OrderIssueEntity } from './entities/order-issue.entity';
import { OrderIssueRelationalRepository } from './repositories/order-issue.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OrderIssueEntity])],
  providers: [
    {
      provide: OrderIssueRepository,
      useClass: OrderIssueRelationalRepository,
    },
  ],
  exports: [OrderIssueRepository],
})
export class RelationalOrderIssuePersistenceModule {}
