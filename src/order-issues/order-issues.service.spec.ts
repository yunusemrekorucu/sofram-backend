import {
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FilesService } from '../files/files.service';
import { MailService } from '../mail/mail.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { anOrder } from '../orders/order.fixture';
import { OrderStatus } from '../orders/order.enums';
import { PaymentsService } from '../payments/payments.service';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../trust/trust.enums';
import { OrderIssue } from './domain/order-issue';
import {
  DuplicateOpenIssueError,
  OrderIssueRepository,
} from './infrastructure/persistence/order-issue.repository';
import { anIssue } from './order-issue.fixture';
import { OrderIssuesService } from './order-issues.service';

const NOW = new Date('2026-10-13T10:00:00Z');
const completed = anOrder({
  status: OrderStatus.completed,
  completedAt: new Date('2026-10-12T10:00:00Z'),
});
const ORDER = { id: 'o1', code: 'S-7K3F', kitchenId: 'k1', totalKurus: 29400 };

const dto = {
  category: IssueCategory.missingItem,
  description: 'Sütlaç paketten çıkmadı',
  requestedResolution: IssueResolution.refundPartial,
};

const conflictKey = (error: unknown) =>
  ((error as ConflictException).getResponse() as { error: string }).error;

const build = (order: Order | null = completed) => {
  const issues = {
    create: jest
      .fn()
      .mockImplementation((data) => Promise.resolve(anIssue(data))),
    findById: jest.fn().mockResolvedValue(anIssue()),
    hasOpen: jest.fn().mockResolvedValue(false),
    list: jest.fn().mockResolvedValue([{ issue: anIssue(), order: ORDER }]),
    resolve: jest
      .fn()
      .mockImplementation(
        async (
          id: string,
          resolution: Partial<OrderIssue>,
          beforeClose: (issue: OrderIssue) => Promise<void>,
        ) => {
          await beforeClose(anIssue({ id }));
          return { issue: anIssue({ id, ...resolution }), order: ORDER };
        },
      ),
  };
  const orders = { findForCustomer: jest.fn().mockResolvedValue(order) };
  const payments = { refundPartial: jest.fn().mockResolvedValue({}) };
  const mail = { issueReported: jest.fn().mockResolvedValue(undefined) };
  const files = { findByIds: jest.fn().mockResolvedValue([]) };
  const config = {
    getOrThrow: (key: string) =>
      ({
        'trust.issueWindowHours': 48,
        'trust.supportEmail': 'destek@sofram.local',
      })[key],
  };

  const service = new OrderIssuesService(
    issues as unknown as OrderIssueRepository,
    orders as unknown as OrderRepository,
    payments as unknown as PaymentsService,
    mail as unknown as MailService,
    files as unknown as FilesService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, issues, payments, mail };
};

describe('OrderIssuesService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('should open a report and mail support', async () => {
      const { service, issues, mail } = build();

      const view = await service.create(9, 'o1', dto);

      expect(issues.create).toHaveBeenCalledWith({
        orderId: 'o1',
        reporterId: 9,
        photos: [],
        ...dto,
      });
      expect(mail.issueReported).toHaveBeenCalledWith({
        to: 'destek@sofram.local',
        data: {
          issueId: 'is1',
          orderCode: 'S-7K3F',
          category: 'missing_item',
          requestedResolution: 'refund_partial',
          description: 'Sütlaç paketten çıkmadı',
        },
      });
      expect(view).toMatchObject({ status: 'open', refundKurus: null });
    });

    it('should keep the report when the mail fails', async () => {
      const { service, mail } = build();
      mail.issueReported.mockRejectedValue(new Error('smtp down'));

      await expect(service.create(9, 'o1', dto)).resolves.toMatchObject({
        status: 'open',
      });
    });

    it('should 404 someone else’s order', async () => {
      const { service } = build(null);

      await expect(service.create(9, 'o1', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should 409 issueNotAllowed while a report is open or after 48 hours', async () => {
      const open = build();
      open.issues.hasOpen.mockResolvedValue(true);
      expect(
        conflictKey(await open.service.create(9, 'o1', dto).catch((e) => e)),
      ).toBe('issueNotAllowed');

      const late = build(
        anOrder({
          status: OrderStatus.completed,
          completedAt: new Date('2026-10-11T09:00:00Z'),
        }),
      );
      expect(
        conflictKey(await late.service.create(9, 'o1', dto).catch((e) => e)),
      ).toBe('issueNotAllowed');
    });

    it('should turn a concurrent second report into issueNotAllowed', async () => {
      const { service, issues, mail } = build();
      issues.create.mockRejectedValue(new DuplicateOpenIssueError());

      expect(
        conflictKey(await service.create(9, 'o1', dto).catch((e) => e)),
      ).toBe('issueNotAllowed');
      expect(mail.issueReported).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('should refund part of the payment before closing', async () => {
      const { service, payments } = build();

      const view = await service.resolve('is1', {
        status: IssueStatus.resolved,
        refundKurus: 6500,
        adminNote: ' Sütlaç ücreti iade edildi ',
      });

      expect(payments.refundPartial).toHaveBeenCalledWith('o1', 6500);
      expect(view).toMatchObject({
        status: 'resolved',
        refundKurus: 6500,
        adminNote: 'Sütlaç ücreti iade edildi',
        order: { code: 'S-7K3F' },
      });
    });

    it('should reject without touching the payment', async () => {
      const { service, payments } = build();

      await expect(
        service.resolve('is1', { status: IssueStatus.rejected }),
      ).resolves.toMatchObject({ status: 'rejected', refundKurus: null });
      expect(payments.refundPartial).not.toHaveBeenCalled();
    });

    it('should 422 a refund on a rejection', async () => {
      const { service } = build();

      await expect(
        service.resolve('is1', {
          status: IssueStatus.rejected,
          refundKurus: 100,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should 409 issueClosed when it was already decided', async () => {
      const { service, issues } = build();
      issues.resolve.mockResolvedValue(null);

      expect(
        conflictKey(
          await service
            .resolve('is1', { status: IssueStatus.resolved })
            .catch((e) => e),
        ),
      ).toBe('issueClosed');
    });

    it('should 404 an unknown issue', async () => {
      const { service, issues } = build();
      issues.findById.mockResolvedValue(null);

      await expect(
        service.resolve('is9', { status: IssueStatus.rejected }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('should list with the status filter and the order', async () => {
    const { service, issues } = build();

    const page = await service.list({
      status: IssueStatus.open,
      page: 1,
      limit: 20,
    });

    expect(issues.list).toHaveBeenCalledWith(IssueStatus.open, {
      offset: 0,
      limit: 20,
    });
    expect(page.data[0]).toMatchObject({ id: 'is1', order: ORDER });
  });
});
