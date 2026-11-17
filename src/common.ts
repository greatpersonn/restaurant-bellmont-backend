import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  SetMetadata,
  Catch,
  ExceptionFilter,
  HttpException,
  ArgumentsHost,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { Database } from './database.js';
import { roleAllowed } from './roles.rules.js';

const { verify } = jwt;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'waiter' | 'kitchen';
}
export const Roles = (...roles: SessionUser['role'][]) =>
  SetMetadata('roles', roles);
export const Public = () => SetMetadata('public', true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser =>
    context.switchToHttp().getRequest<Request & { user: SessionUser }>().user,
);

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (Reflect.getMetadata('public', context.getHandler())) return true;
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    const token = request.cookies?.bellmont_session;
    if (!token)
      throw new UnauthorizedException({ message: 'Authentication required' });
    try {
      const claims = verify(
        token,
        process.env.JWT_SECRET ?? 'development-only-secret',
      ) as SessionUser;
      const result = await this.db.query(
        'SELECT id,name,email,role,is_active FROM users WHERE id=$1',
        [claims.id],
      );
      const user = result.rows[0];
      if (!user || user.is_active !== true)
        throw new UnauthorizedException({
          message: 'Session is no longer active',
        });
      request.user = {
        id: String(user.id),
        name: String(user.name),
        email: String(user.email),
        role: user.role as SessionUser['role'],
      };
      return true;
    } catch {
      throw new UnauthorizedException({ message: 'Invalid session' });
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const roles = Reflect.getMetadata('roles', context.getHandler()) as
      SessionUser['role'][] | undefined;
    if (!roles?.length) return true;
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>().user;
    if (!user || !roleAllowed(user.role, roles))
      throw new ForbiddenException({ message: 'Insufficient role' });
    return true;
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const validation =
      exception instanceof Error && exception.name === 'ZodError'
        ? exception
        : undefined;
    const dbCode =
      typeof exception === 'object' && exception !== null && 'code' in exception
        ? String((exception as { code: unknown }).code)
        : '';
    const databaseConflict = ['23505', '23503', '23514'].includes(dbCode);
    const status =
      validation || dbCode === '22P02'
        ? 422
        : databaseConflict
          ? 409
          : exception instanceof HttpException
            ? exception.getStatus()
            : 500;
    const body = validation
      ? {
          message: 'Validation failed',
          details: JSON.parse(validation.message),
        }
      : databaseConflict
        ? { message: 'Database conflict', details: { code: dbCode } }
        : dbCode === '22P02'
          ? { message: 'Invalid value', details: { code: dbCode } }
          : exception instanceof HttpException
            ? exception.getResponse()
            : { message: 'Internal server error' };
    response.status(status).json({ statusCode: status, error: body });
  }
}
