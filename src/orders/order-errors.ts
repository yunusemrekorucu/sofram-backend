import { ConflictException, HttpStatus } from '@nestjs/common';
import { OrderQuote } from './order-pricing';

/** The order is no longer where the action expects it (a race, or a wrong action). */
export const orderStatusConflict = () =>
  new ConflictException({
    status: HttpStatus.CONFLICT,
    error: 'orderStatusConflict',
  });

/** Prices or fees moved since the client's quote; `data.quote` is the new one. */
export const orderTotalChanged = (quote: OrderQuote) =>
  new ConflictException({
    status: HttpStatus.CONFLICT,
    error: 'orderTotalChanged',
    data: { quote },
  });

/** Account deletion waits until no order is open on either side. */
export const activeOrdersExist = () =>
  new ConflictException({
    status: HttpStatus.CONFLICT,
    error: 'activeOrdersExist',
  });
