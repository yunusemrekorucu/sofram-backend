import { CookTab, Fulfillment, OrderStatus } from './order.enums';
import {
  ACTIVE_STATUSES,
  CLOSED_STATUSES,
  COOK_TAB_STATUSES,
  OrderAction,
  canTransition,
  transitionFor,
} from './order-status';

const ACTIONS: OrderAction[] = [
  'accept',
  'reject',
  'start',
  'ready',
  'dispatch',
  'complete',
  'cookCancel',
  'customerCancel',
  'expire',
];

/** Every allowed (status, action, fulfillment); everything else is a 409. */
const ALLOWED = new Set([
  'pending:accept:pickup',
  'pending:accept:delivery',
  'pending:reject:pickup',
  'pending:reject:delivery',
  'pending:customerCancel:pickup',
  'pending:customerCancel:delivery',
  'pending:expire:pickup',
  'pending:expire:delivery',
  'accepted:start:pickup',
  'accepted:start:delivery',
  'accepted:cookCancel:pickup',
  'accepted:cookCancel:delivery',
  'preparing:ready:pickup',
  'preparing:ready:delivery',
  'preparing:cookCancel:pickup',
  'preparing:cookCancel:delivery',
  'ready:dispatch:delivery',
  'ready:complete:pickup',
  'on_the_way:complete:delivery',
]);

describe('canTransition', () => {
  const cases = Object.values(OrderStatus).flatMap((status) =>
    ACTIONS.flatMap((action) =>
      Object.values(Fulfillment).map(
        (fulfillment) => [status, action, fulfillment] as const,
      ),
    ),
  );

  it.each(cases)(
    'should decide %s × %s × %s from the transition table',
    (status, action, fulfillment) => {
      expect(canTransition(status, action, fulfillment)).toBe(
        ALLOWED.has(`${status}:${action}:${fulfillment}`),
      );
    },
  );
});

describe('transitionFor', () => {
  it('should map each action to its target status', () => {
    expect(transitionFor('accept', Fulfillment.pickup)?.to).toBe(
      OrderStatus.accepted,
    );
    expect(transitionFor('reject', Fulfillment.pickup)?.to).toBe(
      OrderStatus.rejected,
    );
    expect(transitionFor('dispatch', Fulfillment.delivery)?.to).toBe(
      OrderStatus.onTheWay,
    );
    expect(transitionFor('complete', Fulfillment.delivery)).toEqual({
      from: [OrderStatus.onTheWay],
      to: OrderStatus.completed,
    });
    expect(transitionFor('cookCancel', Fulfillment.delivery)?.to).toBe(
      OrderStatus.cancelled,
    );
    expect(transitionFor('expire', Fulfillment.pickup)?.to).toBe(
      OrderStatus.expired,
    );
  });

  it('should not dispatch a pickup order', () => {
    expect(transitionFor('dispatch', Fulfillment.pickup)).toBeNull();
  });
});

describe('status sets', () => {
  it('should split the nine statuses into active and closed', () => {
    expect([...ACTIVE_STATUSES, ...CLOSED_STATUSES].sort()).toEqual(
      Object.values(OrderStatus).sort(),
    );
  });

  it('should map cook tabs to statuses', () => {
    expect(COOK_TAB_STATUSES[CookTab.new]).toEqual([OrderStatus.pending]);
    expect(COOK_TAB_STATUSES[CookTab.preparing]).toEqual([
      OrderStatus.accepted,
      OrderStatus.preparing,
    ]);
    expect(COOK_TAB_STATUSES[CookTab.ready]).toEqual([
      OrderStatus.ready,
      OrderStatus.onTheWay,
    ]);
    expect(COOK_TAB_STATUSES[CookTab.done]).toEqual(CLOSED_STATUSES);
  });
});
