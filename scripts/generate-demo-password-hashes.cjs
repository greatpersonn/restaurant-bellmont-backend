const bcrypt = require('bcryptjs');

const password = 'password';
const fixedSalt = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye';
console.log(bcrypt.hashSync(password, fixedSalt));
