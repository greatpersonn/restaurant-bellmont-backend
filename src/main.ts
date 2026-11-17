import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.use(
    '/api/v1/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  const uploadsDir = resolve(process.env.UPLOADS_DIR ?? 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
  const configured = process.env.CORS_ORIGIN;
  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (
        !origin ||
        origin === configured ||
        /^http:\/\/localhost(?::\d+)?$/.test(origin)
      )
        callback(null, true);
      else callback(new Error('Origin not allowed'));
    },
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  const docs = new DocumentBuilder()
    .setTitle('Bellmont API')
    .setVersion('1.0')
    .addCookieAuth('bellmont_session')
    .build();
  SwaggerModule.setup(
    '/api/docs',
    app,
    SwaggerModule.createDocument(app, docs),
  );
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
