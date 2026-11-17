CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE staff_role AS ENUM ('admin', 'waiter', 'kitchen');
CREATE TYPE dish_tag AS ENUM ('vegetarian', 'vegan', 'gluten-free', 'spicy');
CREATE TYPE table_zone AS ENUM ('main', 'terrace', 'bar');
CREATE TYPE order_status AS ENUM ('new', 'cooking', 'ready', 'served', 'paid', 'cancelled');
CREATE TYPE reservation_status AS ENUM ('pending', 'confirmed', 'seated', 'cancelled');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role staff_role NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), category_id UUID NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL CHECK (price >= 0),
  tags dish_tag[] NOT NULL DEFAULT '{}', is_available BOOLEAN NOT NULL DEFAULT TRUE,
  image_url TEXT, deleted_at TIMESTAMPTZ
);
CREATE INDEX dishes_category_idx ON dishes(category_id) WHERE deleted_at IS NULL;
CREATE TABLE restaurant_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), number INTEGER NOT NULL UNIQUE,
  seats INTEGER NOT NULL CHECK (seats > 0), zone table_zone NOT NULL
);
CREATE SEQUENCE order_number_seq START 1048;
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), number INTEGER NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  table_id UUID NOT NULL REFERENCES restaurant_tables(id), waiter_id UUID NOT NULL REFERENCES users(id),
  guests INTEGER NOT NULL DEFAULT 1 CHECK (guests > 0), status order_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_order_per_table ON orders(table_id) WHERE status NOT IN ('paid', 'cancelled');
CREATE INDEX orders_status_created_idx ON orders(status, created_at DESC);
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id UUID NOT NULL REFERENCES dishes(id), quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_order INTEGER NOT NULL CHECK (price_at_order >= 0), note TEXT
);
CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), table_id UUID REFERENCES restaurant_tables(id),
  guest_name TEXT NOT NULL, phone TEXT NOT NULL, guests INTEGER NOT NULL CHECK (guests > 0),
  starts_at TIMESTAMPTZ NOT NULL, status reservation_status NOT NULL DEFAULT 'pending', note TEXT
);
CREATE INDEX reservations_starts_status_idx ON reservations(starts_at, status);
