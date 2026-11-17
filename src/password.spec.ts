import { verifyPassword } from './password.js';

describe('verifyPassword', () => {
  it('compares the supplied password to the stored bcrypt hash', async () => {
    const hash = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
    await expect(verifyPassword('password', hash)).resolves.toBe(true);
    await expect(verifyPassword('incorrect', hash)).resolves.toBe(false);
  });
});
