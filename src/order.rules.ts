export type Role = 'admin' | 'waiter' | 'kitchen';
export type OrderStatus =
  'new' | 'cooking' | 'ready' | 'served' | 'paid' | 'cancelled';
const next: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'cooking',
  cooking: 'ready',
  ready: 'served',
  served: 'paid',
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  role: Role,
): boolean {
  if (to === 'cancelled')
    return (
      from !== 'paid' &&
      from !== 'cancelled' &&
      (role === 'admin' || role === 'waiter')
    );
  if (next[from] !== to) return false;
  if (to === 'cooking' || to === 'ready')
    return role === 'admin' || role === 'kitchen';
  return role === 'admin' || role === 'waiter';
}

export function computeTableStatus(
  hasActiveOrder: boolean,
  hasReservationWithinTwoHours: boolean,
): 'busy' | 'reserved' | 'free' {
  if (hasActiveOrder) return 'busy';
  if (hasReservationWithinTwoHours) return 'reserved';
  return 'free';
}

export function isActiveOrder(status: OrderStatus): boolean {
  return status !== 'paid' && status !== 'cancelled';
}

export type ReservationStatus =
  'pending' | 'confirmed' | 'seated' | 'cancelled';
export function canTransitionReservation(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return to === 'cancelled'
    ? from !== 'seated' && from !== 'cancelled'
    : (from === 'pending' && to === 'confirmed') ||
        (from === 'confirmed' && to === 'seated');
}
