import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  ParseFilePipeBuilder,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { z } from 'zod';
import { Database } from './database.js';
import { CurrentUser, Roles } from './common.js';
import { Public } from './common.js';
import type { SessionUser } from './common.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { verifyPassword } from './password.js';
const { hash } = bcrypt;
const { sign } = jwt;
import {
  canTransitionOrder,
  canTransitionReservation,
  type ReservationStatus,
} from './order.rules.js';

const fail = (status: number, message: string): never => {
  throw new HttpException({ message }, status);
};
const uuid = z.string().uuid();
const itemSchema = z
  .object({
    dishId: uuid,
    quantity: z.number().int().positive(),
    note: z.string().optional(),
  })
  .strict();
const orderSchema = z
  .object({
    tableId: uuid,
    guests: z.number().int().positive().optional(),
    items: z.array(itemSchema).min(1),
  })
  .strict();

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly db: Database) {}
  @Public()
  @Post('login')
  async login(
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .strict()
      .parse(input);
    const result = await this.db.query(
      'SELECT id,name,email,role,password_hash,is_active FROM users WHERE email=$1',
      [body.email],
    );
    const user = result.rows[0] as Record<string, unknown> | undefined;
    if (!user)
      throw new HttpException({ message: 'Invalid email or password' }, 401);
    if (
      user.is_active !== true ||
      !(await verifyPassword(body.password, String(user.password_hash)))
    )
      fail(401, 'Invalid email or password');
    const safe = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    const token = sign(
      safe,
      process.env.JWT_SECRET ?? 'development-only-secret',
      { expiresIn: '12h' },
    );
    response.cookie('bellmont_session', token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: 43200000,
    });
    return safe;
  }
  @Post('logout') logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('bellmont_session', { path: '/' });
    return { success: true };
  }
  @ApiCookieAuth()
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return user;
  }
}

@ApiTags('bellmont')
@ApiCookieAuth()
@Controller()
export class ApiController {
  constructor(
    private readonly db: Database,
    private readonly realtime: RealtimeGateway,
  ) {}
  @Get('categories') async categories() {
    const r = await this.db.query(
      'SELECT id,name,sort_order AS "sortOrder" FROM categories ORDER BY sort_order,name',
    );
    return { data: r.rows, meta: { total: r.rowCount } };
  }
  @Post('categories') @Roles('admin') async createCategory(
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        sortOrder: z.number().int().optional(),
      })
      .strict()
      .parse(input);
    return (
      await this.db.query(
        'INSERT INTO categories(name,sort_order) VALUES($1,$2) RETURNING id,name,sort_order AS "sortOrder"',
        [b.name, b.sortOrder ?? 0],
      )
    ).rows[0];
  }
  @Patch('categories/:id') @Roles('admin') async updateCategory(
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        name: z.string().min(1).optional(),
        sortOrder: z.number().int().optional(),
      })
      .strict()
      .parse(input);
    const r = await this.db.query(
      'UPDATE categories SET name=COALESCE($2,name),sort_order=COALESCE($3,sort_order) WHERE id=$1 RETURNING id,name,sort_order AS "sortOrder"',
      [id, b.name, b.sortOrder],
    );
    return r.rows[0] ?? fail(404, 'Category not found');
  }
  @Delete('categories/:id') @Roles('admin') async deleteCategory(
    @Param('id') id: string,
  ) {
    const r = await this.db.query(
      'DELETE FROM categories c WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM dishes d WHERE d.category_id=c.id)',
      [id],
    );
    if (!r.rowCount) fail(409, 'Category is in use or does not exist');
    return { success: true };
  }
  @Get('dishes') async dishes(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    const r = await this.db.query(
      `SELECT d.id,d.name,d.description,d.price,c.id AS "categoryId",c.name AS "categoryName",d.tags,d.is_available AS "isAvailable",d.image_url AS "imageUrl" FROM dishes d JOIN categories c ON c.id=d.category_id WHERE d.deleted_at IS NULL AND ($1::uuid IS NULL OR d.category_id=$1) AND ($2::text IS NULL OR d.name ILIKE '%'||$2||'%') ORDER BY c.sort_order,d.name`,
      [categoryId || null, search || null],
    );
    return {
      data: r.rows.map((x) => ({
        ...x,
        category: { id: x.categoryId, name: x.categoryName },
      })),
      meta: { total: r.rowCount },
    };
  }
  @Post('dishes') @Roles('admin') async createDish(@Body() input: unknown) {
    const b = z
      .object({
        categoryId: uuid,
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.number().int().nonnegative(),
        tags: z
          .array(z.enum(['vegetarian', 'vegan', 'gluten-free', 'spicy']))
          .optional(),
      })
      .strict()
      .parse(input);
    return (
      await this.db.query(
        'INSERT INTO dishes(category_id,name,description,price,tags) VALUES($1,$2,$3,$4,$5) RETURNING id,category_id AS "categoryId",name,description,price,tags,is_available AS "isAvailable",image_url AS "imageUrl"',
        [b.categoryId, b.name, b.description ?? '', b.price, b.tags ?? []],
      )
    ).rows[0];
  }
  @Patch('dishes/:id') @Roles('admin') async updateDish(
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        categoryId: uuid.optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        price: z.number().int().nonnegative().optional(),
        tags: z
          .array(z.enum(['vegetarian', 'vegan', 'gluten-free', 'spicy']))
          .optional(),
      })
      .strict()
      .parse(input);
    const r = await this.db.query(
      'UPDATE dishes SET category_id=COALESCE($2,category_id),name=COALESCE($3,name),description=COALESCE($4,description),price=COALESCE($5,price),tags=COALESCE($6,tags) WHERE id=$1 AND deleted_at IS NULL RETURNING id,category_id AS "categoryId",name,description,price,tags,is_available AS "isAvailable",image_url AS "imageUrl"',
      [id, b.categoryId, b.name, b.description, b.price, b.tags],
    );
    return r.rows[0] ?? fail(404, 'Dish not found');
  }
  @Delete('dishes/:id') @Roles('admin') async deleteDish(
    @Param('id') id: string,
  ) {
    const r = await this.db.query(
      'UPDATE dishes SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id',
      [id],
    );
    return r.rows[0] ?? fail(404, 'Dish not found');
  }
  @Patch('dishes/:id/availability')
  @Roles('admin', 'kitchen')
  async availability(@Param('id') id: string, @Body() input: unknown) {
    const b = z.object({ isAvailable: z.boolean() }).strict().parse(input);
    const r = await this.db.query(
      'UPDATE dishes SET is_available=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING id,name,is_available AS "isAvailable"',
      [id, b.isAvailable],
    );
    const value = r.rows[0] ?? fail(404, 'Dish not found');
    this.realtime.publish('dish.availabilityChanged', value);
    return value;
  }
  @Post('dishes/:id/image')
  @Roles('admin')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = process.env.UPLOADS_DIR ?? 'uploads';
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) =>
          cb(
            null,
            `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          ),
      }),
    }),
  )
  async uploadDishImage(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^(image\/(jpeg|png|webp))$/ })
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .build({ errorHttpStatusCode: 422 }),
    )
    file: Express.Multer.File,
  ) {
    const url = `/uploads/${file.filename}`;
    const r = await this.db.query(
      'UPDATE dishes SET image_url=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING id,image_url AS "imageUrl"',
      [id, url],
    );
    return r.rows[0] ?? fail(404, 'Dish not found');
  }
  @Post('tables') @Roles('admin') async createTable(@Body() input: unknown) {
    const b = z
      .object({
        number: z.number().int().positive(),
        seats: z.number().int().positive(),
        zone: z.enum(['main', 'terrace', 'bar']),
      })
      .strict()
      .parse(input);
    return (
      await this.db.query(
        'INSERT INTO restaurant_tables(number,seats,zone) VALUES($1,$2,$3) RETURNING id,number,seats,zone',
        [b.number, b.seats, b.zone],
      )
    ).rows[0];
  }
  @Patch('tables/:id') @Roles('admin') async updateTable(
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        number: z.number().int().positive().optional(),
        seats: z.number().int().positive().optional(),
        zone: z.enum(['main', 'terrace', 'bar']).optional(),
      })
      .strict()
      .parse(input);
    const r = await this.db.query(
      'UPDATE restaurant_tables SET number=COALESCE($2,number),seats=COALESCE($3,seats),zone=COALESCE($4,zone) WHERE id=$1 RETURNING id,number,seats,zone',
      [id, b.number, b.seats, b.zone],
    );
    return r.rows[0] ?? fail(404, 'Table not found');
  }
  @Delete('tables/:id') @Roles('admin') async deleteTable(
    @Param('id') id: string,
  ) {
    const r = await this.db.query(
      "DELETE FROM restaurant_tables t WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.table_id=t.id AND o.status NOT IN ('paid','cancelled')) AND NOT EXISTS(SELECT 1 FROM reservations v WHERE v.table_id=t.id AND v.status IN ('pending','confirmed'))",
      [id],
    );
    if (!r.rowCount) fail(409, 'Table is in use or does not exist');
    return { success: true };
  }
  @Get('tables') @Roles('admin', 'waiter') async tables() {
    const r = await this.db.query(
      `SELECT t.id,t.number,t.seats,t.zone,CASE WHEN o.id IS NOT NULL THEN 'busy' WHEN v.id IS NOT NULL THEN 'reserved' ELSE 'free' END AS status,CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id',o.id,'guests',o.guests,'waiterName',u.name,'createdAt',o.created_at) END AS "activeOrder",CASE WHEN v.id IS NULL THEN NULL ELSE json_build_object('id',v.id,'guestName',v.guest_name,'startsAt',v.starts_at,'guests',v.guests) END AS "nextReservation" FROM restaurant_tables t LEFT JOIN orders o ON o.table_id=t.id AND o.status NOT IN ('paid','cancelled') LEFT JOIN users u ON u.id=o.waiter_id LEFT JOIN LATERAL (SELECT id,guest_name,starts_at,guests FROM reservations r WHERE r.table_id=t.id AND r.status IN ('pending','confirmed') AND r.starts_at BETWEEN now() AND now()+interval '2 hours' ORDER BY starts_at LIMIT 1) v ON true ORDER BY t.number`,
    );
    return { data: r.rows, meta: { total: r.rowCount } };
  }
  @Get('orders') async orders(@Query('status') status?: string) {
    const r = await this.db.query(
      'SELECT id FROM orders WHERE ($1::order_status IS NULL OR status=$1) ORDER BY created_at DESC',
      [status || null],
    );
    return {
      data: await Promise.all(r.rows.map((x) => this.order(String(x.id)))),
      meta: { total: r.rowCount },
    };
  }
  @Get('orders/:id') async getOrder(@Param('id') id: string) {
    return this.order(id);
  }
  @Post('orders/:id/items') @Roles('admin', 'waiter') async addItems(
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({ items: z.array(itemSchema).min(1) })
      .strict()
      .parse(input);
    await this.db.transaction(async (c) => {
      const o = await c.query(
        'SELECT status FROM orders WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!o.rows[0]) fail(404, 'Order not found');
      if (o.rows[0].status !== 'new')
        fail(409, 'Items can only change while order is new');
      for (const it of b.items) {
        const d = await c.query(
          'SELECT price,is_available FROM dishes WHERE id=$1 AND deleted_at IS NULL',
          [it.dishId],
        );
        if (!d.rows[0]) fail(404, 'Dish not found');
        if (!d.rows[0].is_available) fail(409, 'Dish is unavailable');
        await c.query(
          'INSERT INTO order_items(order_id,dish_id,quantity,price_at_order,note) VALUES($1,$2,$3,$4,$5)',
          [id, it.dishId, it.quantity, d.rows[0].price, it.note ?? null],
        );
      }
    });
    const result = await this.order(id);
    this.realtime.publish('order.updated', result);
    return result;
  }
  @Patch('orders/:id/items/:itemId') @Roles('admin', 'waiter') async updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        quantity: z.number().int().positive().optional(),
        note: z.string().nullable().optional(),
      })
      .strict()
      .parse(input);
    const r = await this.db.query(
      `UPDATE order_items i SET quantity=COALESCE($3,quantity),note=CASE WHEN $4 THEN $5 ELSE note END FROM orders o WHERE i.id=$2 AND i.order_id=o.id AND o.id=$1 AND o.status='new' RETURNING i.id`,
      [id, itemId, b.quantity, b.note !== undefined, b.note ?? null],
    );
    if (!r.rowCount) fail(409, 'Order item not found or order is not new');
    const result = await this.order(id);
    this.realtime.publish('order.updated', result);
    return result;
  }
  @Delete('orders/:id/items/:itemId')
  @Roles('admin', 'waiter')
  async deleteItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    const r = await this.db.query(
      `DELETE FROM order_items i USING orders o WHERE i.id=$2 AND i.order_id=o.id AND o.id=$1 AND o.status='new'`,
      [id, itemId],
    );
    if (!r.rowCount) fail(409, 'Order item not found or order is not new');
    const result = await this.order(id);
    this.realtime.publish('order.updated', result);
    return result;
  }
  private async order(id: string) {
    const r = await this.db.query(
      `SELECT o.id,o.number,json_build_object('id',t.id,'number',t.number) AS table,json_build_object('id',u.id,'name',u.name) AS waiter,o.status,COALESCE((SELECT json_agg(json_build_object('id',i.id,'dishId',i.dish_id,'dishName',d.name,'quantity',i.quantity,'priceAtOrder',i.price_at_order,'note',i.note)) FROM order_items i JOIN dishes d ON d.id=i.dish_id WHERE i.order_id=o.id),'[]') AS items,COALESCE((SELECT sum(quantity*price_at_order) FROM order_items WHERE order_id=o.id),0)::int AS subtotal,o.created_at AS "createdAt" FROM orders o JOIN restaurant_tables t ON t.id=o.table_id JOIN users u ON u.id=o.waiter_id WHERE o.id=$1`,
      [id],
    );
    return r.rows[0] ?? fail(404, 'Order not found');
  }
  @Post('orders') @Roles('admin', 'waiter') async createOrder(
    @Body() input: unknown,
    @CurrentUser() user: SessionUser,
  ) {
    const b = orderSchema.parse(input);
    try {
      const id = await this.db.transaction(async (c) => {
        const q = await c.query(
          'INSERT INTO orders(table_id,waiter_id,guests) VALUES($1,$2,$3) RETURNING id',
          [b.tableId, user.id, b.guests ?? 1],
        );
        for (const it of b.items) {
          const d = await c.query(
            'SELECT price,is_available FROM dishes WHERE id=$1 AND deleted_at IS NULL',
            [it.dishId],
          );
          if (!d.rows[0]) fail(404, 'Dish not found');
          if (!d.rows[0].is_available) fail(409, 'Dish is unavailable');
          await c.query(
            'INSERT INTO order_items(order_id,dish_id,quantity,price_at_order,note) VALUES($1,$2,$3,$4,$5)',
            [
              q.rows[0].id,
              it.dishId,
              it.quantity,
              d.rows[0].price,
              it.note ?? null,
            ],
          );
        }
        return q.rows[0].id as string;
      });
      const result = await this.order(id);
      this.realtime.publish('order.created', result);
      return result;
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        fail(409, 'Table already has an active order');
      throw e;
    }
  }
  @Patch('orders/:id/status') async status(
    @Param('id') id: string,
    @Body() input: unknown,
    @CurrentUser() user: SessionUser,
  ) {
    const b = z
      .object({
        status: z.enum([
          'new',
          'cooking',
          'ready',
          'served',
          'paid',
          'cancelled',
        ]),
      })
      .strict()
      .parse(input);
    const r = await this.db.query('SELECT status FROM orders WHERE id=$1', [
      id,
    ]);
    if (!r.rows[0]) fail(404, 'Order not found');
    const old = r.rows[0].status as import('./order.rules.js').OrderStatus;
    if (!canTransitionOrder(old, b.status, user.role))
      fail(409, 'Invalid order status transition');
    const updated = await this.db.query(
      'UPDATE orders SET status=$2,updated_at=now() WHERE id=$1 AND status=$3',
      [id, b.status, old],
    );
    if (!updated.rowCount) fail(409, 'Order status changed concurrently');
    const result = await this.order(id);
    this.realtime.publish('order.updated', result);
    return result;
  }
  @Get('reservations') @Roles('admin', 'waiter') async reservations(
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    const r = await this.db.query(
      'SELECT id,table_id AS "tableId",guest_name AS "guestName",phone,guests,starts_at AS "startsAt",status,note FROM reservations WHERE ($1::date IS NULL OR starts_at::date=$1) AND ($2::reservation_status IS NULL OR status=$2) ORDER BY starts_at',
      [date || null, status || null],
    );
    return { data: r.rows, meta: { total: r.rowCount } };
  }
  @Post('reservations') @Roles('admin', 'waiter') async createReservation(
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        tableId: uuid.optional(),
        guestName: z.string().min(1),
        phone: z.string().min(1),
        guests: z.number().int().positive(),
        startsAt: z.string().datetime(),
        note: z.string().optional(),
      })
      .strict()
      .parse(input);
    const result = (
      await this.db.query(
        'INSERT INTO reservations(table_id,guest_name,phone,guests,starts_at,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,table_id AS "tableId",guest_name AS "guestName",phone,guests,starts_at AS "startsAt",status,note',
        [
          b.tableId ?? null,
          b.guestName,
          b.phone,
          b.guests,
          b.startsAt,
          b.note ?? null,
        ],
      )
    ).rows[0];
    this.realtime.publish('reservation.created', result);
    return result;
  }
  @Patch('reservations/:id') @Roles('admin', 'waiter') async updateReservation(
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        tableId: uuid.nullable().optional(),
        guestName: z.string().min(1).optional(),
        phone: z.string().min(1).optional(),
        guests: z.number().int().positive().optional(),
        startsAt: z.string().datetime().optional(),
        status: z
          .enum(['pending', 'confirmed', 'seated', 'cancelled'])
          .optional(),
        note: z.string().nullable().optional(),
      })
      .strict()
      .parse(input);
    if (b.status) {
      const current = await this.db.query(
        'SELECT status FROM reservations WHERE id=$1',
        [id],
      );
      if (!current.rows[0]) fail(404, 'Reservation not found');
      if (
        !canTransitionReservation(
          current.rows[0].status as ReservationStatus,
          b.status,
        )
      )
        fail(409, 'Invalid reservation status transition');
    }
    const r = await this.db.query(
      'UPDATE reservations SET table_id=CASE WHEN $2 THEN $3 ELSE table_id END,guest_name=COALESCE($4,guest_name),phone=COALESCE($5,phone),guests=COALESCE($6,guests),starts_at=COALESCE($7,starts_at),status=COALESCE($8,status),note=CASE WHEN $9 THEN $10 ELSE note END WHERE id=$1 RETURNING id,table_id AS "tableId",guest_name AS "guestName",phone,guests,starts_at AS "startsAt",status,note',
      [
        id,
        b.tableId !== undefined,
        b.tableId ?? null,
        b.guestName,
        b.phone,
        b.guests,
        b.startsAt,
        b.status,
        b.note !== undefined,
        b.note ?? null,
      ],
    );
    const result = r.rows[0] ?? fail(404, 'Reservation not found');
    this.realtime.publish('reservation.updated', result);
    return result;
  }
  @Get('stats/today') @Roles('admin') async stats() {
    const timezone = process.env.RESTAURANT_TIMEZONE ?? 'UTC';
    const [totals, hours, dishes, tables, reservations] = await Promise.all([
      this.db.query(
        `SELECT COALESCE(sum((SELECT sum(quantity*price_at_order) FROM order_items WHERE order_id=o.id)) FILTER(WHERE status='paid'),0)::int AS revenue,count(*)::int AS "ordersCount",count(*) FILTER(WHERE status NOT IN ('paid','cancelled'))::int AS "openOrdersCount" FROM orders o WHERE (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date`,
        [timezone],
      ),
      this.db.query(
        `SELECT extract(hour FROM created_at AT TIME ZONE $1)::int AS hour,COALESCE(sum((SELECT sum(quantity*price_at_order) FROM order_items WHERE order_id=o.id)),0)::int AS revenue FROM orders o WHERE status='paid' AND (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date GROUP BY hour ORDER BY hour`,
        [timezone],
      ),
      this.db.query(
        `SELECT d.id AS "dishId",d.name,sum(i.quantity)::int AS sold FROM order_items i JOIN dishes d ON d.id=i.dish_id JOIN orders o ON o.id=i.order_id WHERE o.status='paid' AND (o.created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date GROUP BY d.id,d.name ORDER BY sold DESC LIMIT 5`,
        [timezone],
      ),
      this.db.query(
        `SELECT count(*) FILTER(WHERE EXISTS(SELECT 1 FROM orders o WHERE o.table_id=t.id AND o.status NOT IN ('paid','cancelled')))::int AS occupied,count(*)::int AS total FROM restaurant_tables t`,
      ),
      this.db.query(
        `SELECT count(*)::int AS total FROM reservations WHERE (starts_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date`,
        [timezone],
      ),
    ]);
    return {
      ...totals.rows[0],
      tablesOccupied: tables.rows[0].occupied,
      tablesTotal: tables.rows[0].total,
      reservationsCount: reservations.rows[0].total,
      revenueByHour: hours.rows,
      topDishes: dishes.rows,
    };
  }
  @Get('users') @Roles('admin') async users() {
    const r = await this.db.query(
      'SELECT id,name,email,role,is_active AS "isActive" FROM users ORDER BY name',
    );
    return { data: r.rows, meta: { total: r.rowCount } };
  }
  @Post('users') @Roles('admin') async addUser(@Body() input: unknown) {
    const b = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
        role: z.enum(['admin', 'waiter', 'kitchen']),
      })
      .strict()
      .parse(input);
    return (
      await this.db.query(
        'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,is_active AS "isActive"',
        [b.name, b.email, await hash(b.password, 10), b.role],
      )
    ).rows[0];
  }
  @Patch('users/:id') @Roles('admin') async editUser(
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const b = z
      .object({
        role: z.enum(['admin', 'waiter', 'kitchen']).optional(),
        isActive: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    const r = await this.db.query(
      'UPDATE users SET role=COALESCE($2,role),is_active=COALESCE($3,is_active) WHERE id=$1 RETURNING id,name,email,role,is_active AS "isActive"',
      [id, b.role, b.isActive],
    );
    return r.rows[0] ?? fail(404, 'User not found');
  }
}
