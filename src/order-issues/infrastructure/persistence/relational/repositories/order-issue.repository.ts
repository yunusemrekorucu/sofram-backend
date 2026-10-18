import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { IssueStatus } from '../../../../../trust/trust.enums';
import { NullableType } from '../../../../../utils/types/nullable.type';
import {
  NewOrderIssue,
  OrderIssue,
  OrderIssueResolution,
} from '../../../../domain/order-issue';
import {
  DuplicateOpenIssueError,
  IssuePage,
  OrderIssueRepository,
  OrderIssueWithOrder,
} from '../../order-issue.repository';
import { OrderIssueEntity } from '../entities/order-issue.entity';
import { OrderIssueMapper } from '../mappers/order-issue.mapper';

const isOpenIssueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string }).code === '23505' &&
  (error.driverError as { constraint?: string }).constraint ===
    'IDX_order_issue_open_order';

const withOrder = (entity: OrderIssueEntity): OrderIssueWithOrder => {
  const order = entity.order as OrderEntity;

  return {
    issue: OrderIssueMapper.toDomain(entity),
    order: {
      id: order.id,
      code: order.code,
      kitchenId: order.kitchenId,
      totalKurus: order.totalKurus,
    },
  };
};

@Injectable()
export class OrderIssueRelationalRepository implements OrderIssueRepository {
  constructor(
    @InjectRepository(OrderIssueEntity)
    private readonly issues: Repository<OrderIssueEntity>,
  ) {}

  async create(issue: NewOrderIssue): Promise<OrderIssue> {
    try {
      const entity = await this.issues.save(
        this.issues.create(OrderIssueMapper.toPersistence(issue)),
      );
      return OrderIssueMapper.toDomain(entity);
    } catch (error) {
      if (isOpenIssueViolation(error)) {
        throw new DuplicateOpenIssueError();
      }

      throw error;
    }
  }

  async findById(id: OrderIssue['id']): Promise<NullableType<OrderIssue>> {
    const entity = await this.issues.findOne({ where: { id } });
    return entity ? OrderIssueMapper.toDomain(entity) : null;
  }

  hasOpen(orderId: OrderIssue['orderId']): Promise<boolean> {
    return this.issues.exists({ where: { orderId, status: IssueStatus.open } });
  }

  async list(
    status: IssueStatus | undefined,
    page: IssuePage,
  ): Promise<OrderIssueWithOrder[]> {
    const entities = await this.issues.find({
      where: status ? { status } : {},
      relations: { order: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: page.offset,
      take: page.limit,
    });
    return entities.map(withOrder);
  }

  async resolve(
    id: OrderIssue['id'],
    resolution: OrderIssueResolution,
    beforeClose: (issue: OrderIssue) => Promise<void>,
  ): Promise<NullableType<OrderIssueWithOrder>> {
    const resolved = await this.issues.manager.transaction(async (manager) => {
      const entity = await manager.findOne(OrderIssueEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entity || entity.status !== IssueStatus.open) {
        return false;
      }

      await beforeClose(OrderIssueMapper.toDomain(entity));
      await manager.update(OrderIssueEntity, { id }, resolution);
      return true;
    });

    if (!resolved) {
      return null;
    }

    return withOrder(
      await this.issues.findOneOrFail({
        where: { id },
        relations: { order: true },
      }),
    );
  }
}
