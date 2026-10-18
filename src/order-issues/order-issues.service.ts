import {
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FilesService } from '../files/files.service';
import { MailService } from '../mail/mail.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { PaymentsService } from '../payments/payments.service';
import { issueClosed, issueNotAllowed } from '../trust/trust-errors';
import { photosByIds } from '../trust/trust-photos';
import { canReportIssue } from '../trust/trust-rules';
import { IssueStatus } from '../trust/trust.enums';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { OrderIssue } from './domain/order-issue';
import {
  ListOrderIssuesQueryDto,
  ResolveOrderIssueDto,
} from './dto/admin-order-issues.dto';
import { CreateOrderIssueDto } from './dto/create-order-issue.dto';
import {
  DuplicateOpenIssueError,
  OrderIssueRepository,
} from './infrastructure/persistence/order-issue.repository';
import { adminIssueView, issueView } from './presenters';
import { AdminIssueView, IssueView } from './views';

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** "Sorun bildir": the customer reports, support is mailed, an admin decides. */
@Injectable()
export class OrderIssuesService {
  private readonly logger = new Logger(OrderIssuesService.name);

  constructor(
    private readonly issueRepository: OrderIssueRepository,
    private readonly orderRepository: OrderRepository,
    private readonly paymentsService: PaymentsService,
    private readonly mailService: MailService,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** 409 issueNotAllowed outside the window or while a report is open. */
  async create(
    customerId: User['id'],
    orderId: Order['id'],
    dto: CreateOrderIssueDto,
  ): Promise<IssueView> {
    const order = await orNotFound(
      this.orderRepository.findForCustomer(customerId, orderId),
    );
    const windowHours = this.configService.getOrThrow(
      'trust.issueWindowHours',
      {
        infer: true,
      },
    );
    const hasOpen = await this.issueRepository.hasOpen(order.id);

    if (!canReportIssue(order, hasOpen, new Date(), windowHours)) {
      throw issueNotAllowed();
    }

    const photos = await photosByIds(this.filesService, dto.photoIds ?? []);
    let issue: OrderIssue;

    try {
      issue = await this.issueRepository.create({
        orderId: order.id,
        reporterId: customerId,
        category: dto.category,
        description: dto.description,
        photos,
        requestedResolution: dto.requestedResolution,
      });
    } catch (error) {
      if (error instanceof DuplicateOpenIssueError) {
        throw issueNotAllowed();
      }

      throw error;
    }

    await this.notifySupport(order, issue);
    return issueView(issue);
  }

  async list(
    query: ListOrderIssuesQueryDto,
  ): Promise<InfinityPaginationResponseDto<AdminIssueView>> {
    const issues = await this.issueRepository.list(query.status, {
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });

    return infinityPagination(issues.map(adminIssueView), {
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * resolved (+ optional partial refund through PaymentsService) or rejected.
   * A closed issue is a 409 issueClosed; a refund beyond what is left is a
   * 422 refundKurus and the issue stays open.
   */
  async resolve(
    id: OrderIssue['id'],
    dto: ResolveOrderIssueDto,
  ): Promise<AdminIssueView> {
    if (dto.status === IssueStatus.rejected && dto.refundKurus !== undefined) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { refundKurus: 'onlyWhenResolved' },
      });
    }

    await orNotFound(this.issueRepository.findById(id));

    const resolved = await this.issueRepository.resolve(
      id,
      {
        status: dto.status,
        refundKurus: dto.refundKurus ?? null,
        adminNote: dto.adminNote?.trim() || null,
        resolvedAt: new Date(),
      },
      async (issue) => {
        if (dto.refundKurus !== undefined) {
          await this.paymentsService.refundPartial(
            issue.orderId,
            dto.refundKurus,
          );
        }
      },
    );

    if (!resolved) {
      throw issueClosed();
    }

    return adminIssueView(resolved);
  }

  /** Never fails the report: a mail that cannot be sent is logged. */
  private async notifySupport(order: Order, issue: OrderIssue): Promise<void> {
    try {
      await this.mailService.issueReported({
        to: this.configService.getOrThrow('trust.supportEmail', {
          infer: true,
        }),
        data: {
          issueId: issue.id,
          orderCode: order.code,
          category: issue.category,
          requestedResolution: issue.requestedResolution,
          description: issue.description,
        },
      });
    } catch (error) {
      this.logger.error(
        `Support mail failed for issue ${issue.id}: ${reasonOf(error)}`,
      );
    }
  }
}
