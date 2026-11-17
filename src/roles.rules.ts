export type StaffRole = 'admin' | 'waiter' | 'kitchen';
export function roleAllowed(
  userRole: StaffRole,
  requiredRoles: readonly StaffRole[],
): boolean {
  return requiredRoles.length === 0 || requiredRoles.includes(userRole);
}
