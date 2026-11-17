# Bellmont backend

REST API and Socket.IO server for the Bellmont restaurant staff application. It uses NestJS, PostgreSQL, bcrypt password hashes, JWT sessions in an httpOnly cookie, and Socket.IO.

## 1. Run the backend locally with Docker

Requirements: Docker Desktop with its Linux container engine running.

From PowerShell:

```powershell
cd E:\UniProject\server
Copy-Item .env.example .env
docker compose -f docker/docker-compose.yaml up --build -d
```

Compose starts PostgreSQL, the API, and Adminer. PostgreSQL creates the schema and demo data from `db/01-schema.sql` and `db/02-seed.sql` only when its data volume is first initialized. The database and uploaded dish images persist in named Docker volumes.

Useful URLs:

- API health: <http://localhost:3000/api/v1/health>
- Swagger UI: <http://localhost:3000/api/docs>
- Adminer: <http://localhost:8080>

Adminer connection values for the checked-in local defaults:

| Field | Value |
| --- | --- |
| System | PostgreSQL |
| Server | `db` |
| Username | `bellmont` |
| Password | `bellmont_dev` |
| Database | `bellmont` |

If you change the `POSTGRES_*` values in `.env`, use those values in Adminer as well. The API uses the service hostname `db` inside Compose; host-run development uses `localhost` in `DATABASE_URL`.

To stop the services while preserving database data, run `docker compose -f docker/docker-compose.yaml down`. **Do not add `-v`** unless you intend to permanently erase the local database and uploaded files. SQL init scripts do not rerun for an existing database volume.

## 2. Demo accounts

All accounts use the local demo password `password`:

| Role | Email |
| --- | --- |
| Admin | `anna@bellmont.example` |
| Waiter | `waiter@bellmont.example` |
| Kitchen | `kitchen@bellmont.example` |

`.example` is an intentionally non-public demo domain; use the listed email literally. No email is sent. Passwords are stored as bcrypt hashes. Never use these credentials outside local development.

## 3. Connect the frontend

The frontend should use this API base URL during local development:

```text
http://localhost:3000/api/v1
```

Set the backend's `CORS_ORIGIN` in `server/.env` to the frontend's exact origin. The default is `http://localhost:5173` for Vite. The API also allows `http://localhost` with any port for local development. Browser requests must include credentials so the browser sends the session cookie:

```ts
const API = 'http://localhost:3000/api/v1';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw Object.assign(new Error(error.error?.message ?? 'Request failed'), {
      status: response.status,
      details: error.error?.details,
    });
  }

  return response.json() as Promise<T>;
}
```

Sign in with `POST /auth/login` and JSON `{ "email": "anna@bellmont.example", "password": "password" }`. A successful login returns the staff profile and sets the `bellmont_session` httpOnly cookie. The token is intentionally not returned to JavaScript; do not store a token in localStorage or send an `Authorization: Bearer` header. On app startup call `GET /auth/me` with `credentials: 'include'` to restore the session. Use `POST /auth/logout` to clear the cookie.

In local HTTP development, `COOKIE_SECURE=false`. For HTTPS deployment, set `COOKIE_SECURE=true`, use a strong private `JWT_SECRET`, and configure the exact frontend origin in `CORS_ORIGIN`.

### REST routes and permissions

All routes below are prefixed with `/api/v1`. Every endpoint except login and health needs the session cookie.

| Route | Access | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Health check |
| `POST /auth/login` | Public | Create session cookie |
| `POST /auth/logout`, `GET /auth/me` | All roles | End/read current session |
| `GET /categories` | All roles | List menu categories |
| `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | Admin | Manage categories; delete requires an empty category |
| `GET /dishes?categoryId=&search=` | All roles | List non-deleted dishes |
| `POST /dishes`, `PATCH /dishes/:id`, `DELETE /dishes/:id`, `POST /dishes/:id/image` | Admin | Manage dishes; delete is soft-delete |
| `PATCH /dishes/:id/availability` | Admin, kitchen | Toggle availability / stop-list |
| `GET /tables` | Admin, waiter | Floor plan and computed table status |
| `POST /tables`, `PATCH /tables/:id`, `DELETE /tables/:id` | Admin | Manage tables |
| `GET /orders`, `GET /orders/:id` | All roles | View orders |
| `POST /orders`, `POST /orders/:id/items`, `PATCH/DELETE /orders/:id/items/:itemId` | Admin, waiter | Create orders and edit items while status is `new` |
| `PATCH /orders/:id/status` | Role depends on transition | Advance/cancel an order |
| `GET /reservations?date=YYYY-MM-DD&status=` | Admin, waiter | List/filter reservations |
| `POST /reservations`, `PATCH /reservations/:id` | Admin, waiter | Create/update reservations |
| `GET /stats/today` | Admin | Daily dashboard statistics |
| `GET /users`, `POST /users`, `PATCH /users/:id` | Admin | Manage staff accounts |

Order transitions are `new → cooking → ready → served → paid`, with cancellation allowed to admins and waiters while an order is active. Kitchen staff advance `new → cooking → ready`; admins and waiters advance `ready → served → paid`. Reservation transitions are `pending → confirmed → seated`, or cancellation before seating. A table is `busy` when it has an active order, otherwise `reserved` for a reservation starting in the next two hours, otherwise `free`.

### Data conventions

- IDs are UUID strings; JSON property names are camelCase.
- Prices are integer minor units (for example, `2800` means 28.00 in the configured `CURRENCY`).
- Timestamps are ISO 8601 strings in UTC.
- List responses use `{ "data": [...], "meta": { "total": n } }`.
- Validation errors use HTTP `422`; missing/invalid sessions `401`; forbidden roles `403`; missing records `404`; conflicts (including an unavailable dish or a second active order on a table) `409`.
- **Current implementation note:** list routes return the full matching list and `meta.total`; `page` and `limit` are not implemented yet.

### Common request examples

Create an order (the UI gets `tableId` and `dishId` from `/tables` and `/dishes`):

```json
{
  "tableId": "<table UUID>",
  "guests": 2,
  "items": [{ "dishId": "<dish UUID>", "quantity": 2, "note": "No parmesan" }]
}
```

Order item mutations are accepted only while the order is `new`. `POST /orders/:id/items` accepts `{ "items": [...] }`. Order responses include nested `table` and `waiter`, `items`, integer `subtotal`, and `createdAt`.

For dish photos, send `multipart/form-data` to `POST /dishes/:id/image` with file field `file`. JPEG, PNG, and WebP are accepted, up to 5 MB. The response contains an `imageUrl` such as `/uploads/<file>`; images are served from the API origin at that path and persist in the Docker `uploads` volume.

### Realtime updates

Connect Socket.IO to `http://localhost:3000` with credentials enabled. The browser sends the same httpOnly cookie during the handshake:

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { withCredentials: true });
socket.on('order.created', (order) => { /* update kitchen/floor state */ });
socket.on('order.updated', (order) => { /* refresh the order */ });
socket.on('dish.availabilityChanged', (dish) => { /* update availability */ });
socket.on('reservation.created', (reservation) => { /* update reservations */ });
socket.on('reservation.updated', (reservation) => { /* refresh reservation */ });
```

Unauthenticated socket connections are rejected. Socket CORS uses the same configured origin as the REST API.

## 4. Run API without Docker

Requirements: Node.js 22+, Yarn 1, and PostgreSQL. Create a local database, copy `.env.example` to `.env`, and apply `db/01-schema.sql` followed by `db/02-seed.sql` once. Then:

```powershell
cd E:\UniProject\server
Copy-Item .env.example .env
yarn install
yarn build
yarn start:dev
```

The local `.env` uses `DATABASE_URL` with `localhost`. `UPLOADS_DIR` defaults to `./uploads`.

## 5. Environment files and Git

Commit `.env.example`; do not commit `.env`, session cookie files, or local uploads. `.env.example` contains only local demo defaults. `JWT_SECRET` in `.env` must be replaced with a long random value before any shared environment. The frontend does not need backend secrets; it only needs its API base URL.

## 6. Developer checks

From `server/`:

```powershell
yarn build
yarn lint
yarn test --runInBand
```
