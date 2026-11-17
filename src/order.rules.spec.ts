import {
  canTransitionOrder,
  canTransitionReservation,
  computeTableStatus,
  isActiveOrder,
} from './order.rules.js';
import { readFileSync } from 'node:fs';

describe('order rules', () => {
  it('allows only the next status and enforces role ownership', () => {
    expect(canTransitionOrder('new', 'cooking', 'kitchen')).toBe(true);
    expect(canTransitionOrder('new', 'ready', 'kitchen')).toBe(false);
    expect(canTransitionOrder('new', 'cooking', 'waiter')).toBe(false);
    expect(canTransitionOrder('ready', 'served', 'waiter')).toBe(true);
  });
  it('computes table occupancy with active orders taking precedence', () => {
    expect(computeTableStatus(true, true)).toBe('busy');
    expect(computeTableStatus(false, true)).toBe('reserved');
    expect(computeTableStatus(false, false)).toBe('free');
  });
  it('considers paid and cancelled orders inactive for the per-table rule', () => {
    expect(isActiveOrder('new')).toBe(true);
    expect(isActiveOrder('paid')).toBe(false);
    expect(isActiveOrder('cancelled')).toBe(false);
  });
  it('keeps a partial unique index in the schema as a database backstop', () => {
    const schema = readFileSync('db/01-schema.sql', 'utf8');
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX one_active_order_per_table ON orders\(table_id\) WHERE status NOT IN \('paid', 'cancelled'\)/,
    );
  });
  it('enforces sequential reservation statuses', () => {
    expect(canTransitionReservation('pending', 'confirmed')).toBe(true);
    expect(canTransitionReservation('pending', 'seated')).toBe(false);
    expect(canTransitionReservation('confirmed', 'cancelled')).toBe(true);
  });
});
