export enum OrderStatus {
  pending = 'pending',
  accepted = 'accepted',
  preparing = 'preparing',
  ready = 'ready',
  onTheWay = 'on_the_way',
  completed = 'completed',
  rejected = 'rejected',
  cancelled = 'cancelled',
  expired = 'expired',
}

export enum Fulfillment {
  pickup = 'pickup',
  delivery = 'delivery',
}

export enum CancelledBy {
  customer = 'customer',
  cook = 'cook',
  system = 'system',
}

/** Required for reject and the cook's cancel; null otherwise. */
export enum OrderReason {
  outOfIngredients = 'out_of_ingredients',
  tooBusy = 'too_busy',
  timeNotSuitable = 'time_not_suitable',
  other = 'other',
}

/** The cook's order tabs (GET /kitchens/me/orders?tab=). */
export enum CookTab {
  new = 'new',
  preparing = 'preparing',
  ready = 'ready',
  done = 'done',
}

/** The customer's order list (GET /orders?scope=). */
export enum OrderScope {
  active = 'active',
  past = 'past',
}
