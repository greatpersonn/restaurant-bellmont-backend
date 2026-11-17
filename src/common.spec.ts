import { roleAllowed } from './roles.rules.js';

describe('role authorization policy', () => {
  it('allows a listed role and rejects a different role', () => {
    expect(roleAllowed('admin', ['admin'])).toBe(true);
    expect(roleAllowed('waiter', ['admin'])).toBe(false);
    expect(roleAllowed('kitchen', [])).toBe(true);
  });
});
