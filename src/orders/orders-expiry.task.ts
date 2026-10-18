import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';

const SWEEP_MS = 30_000;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Every 30 s: expires pending orders nobody answered (portions and money go
 * back) and forgets Idempotency-Keys older than a day. Reads expire their
 * own orders too, so the sweep's delay never shows on screen.
 */
@Injectable()
export class OrdersExpiryTask {
  private readonly logger = new Logger(OrdersExpiryTask.name);
  private running = false;

  constructor(
    private readonly lifecycle: OrderLifecycleService,
    private readonly orderRepository: OrderRepository,
  ) {}

  @Interval(SWEEP_MS)
  async sweep(now: Date = new Date()): Promise<void> {
    // A slow pass must not overlap the next tick.
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const expired = await this.lifecycle.expireOverdue({}, now);

      if (expired > 0) {
        this.logger.log(`Expired ${expired} unanswered order(s)`);
      }

      await this.orderRepository.deleteRequestsBefore(
        new Date(now.getTime() - REQUEST_TTL_MS),
      );
    } catch (error) {
      this.logger.error(
        `Order sweep failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
