import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const email = 'anna@bellmont.example';
const password = 'password';
const salt = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  if (process.argv.includes('--reset')) {
    const passwordHash = bcrypt.hashSync(password, salt);
    const update = await client.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2',
      [passwordHash, email],
    );
    console.log({ resetRows: update.rowCount });
  }

  const result = await client.query(
    'SELECT password_hash, is_active FROM users WHERE email = $1',
    [email],
  );
  const user = result.rows[0];
  console.log({
    accountFound: Boolean(user),
    accountActive: user?.is_active ?? false,
    hashLength: user?.password_hash.length ?? 0,
    passwordMatches: user
      ? bcrypt.compareSync(password, user.password_hash)
      : false,
  });
} catch (error) {
  console.error('Could not verify demo login against the API database.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
