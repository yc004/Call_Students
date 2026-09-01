import 'reflect-metadata';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ApiResponseInterceptor } from './common/api-response.interceptor.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { migrate } from './migrate.js';

export async function bootstrap():Promise<NestFastifyApplication> {
  const config = loadConfig();
  const database = createDatabase(config);
  await migrate(database);
  // JSON 头像通道用于兼容鸿蒙微信不回调二进制 wx.request；5MB 图片经 Base64 后约 6.7MB。
  const adapter = new FastifyAdapter({ logger:{ level:config.LOG_LEVEL }, trustProxy:config.TRUST_PROXY, bodyLimit:8 * 1024 * 1024 });
  adapter.getInstance().addContentTypeParser(
    ['image/png','image/x-png','image/jpeg','image/jpg','image/pjpeg','image/webp'],
    {parseAs:'buffer',bodyLimit:25*1024*1024},
    (_request,body,done)=>done(null,body),
  );
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register({ config, database }), adapter, {
    bufferLogs:true,
  });

  const adminRoot = resolve(config.ADMIN_WEB_ROOT || 'admin-web/apps/web-antd/dist');
  if (existsSync(adminRoot)) {
    app.useStaticAssets({ root:adminRoot, prefix:'/admin/' });
    adapter.getInstance().get('/', async (_request, reply) => reply.redirect('/admin/'));
  }
  const uploadRoot=resolve('uploads');
  mkdirSync(resolve(uploadRoot,'avatars'),{recursive:true});
  mkdirSync(resolve(uploadRoot,'logos'),{recursive:true});
  app.useStaticAssets({root:uploadRoot,prefix:'/uploads/',decorateReply:false});

  app.setGlobalPrefix('api/v2');
  const developmentOrigins=['http://127.0.0.1:5666','http://localhost:5666'];
  const configuredOrigins=config.CORS_ORIGINS.split(',').map(value=>value.trim()).filter(Boolean);
  app.enableCors({origin:configuredOrigins.length?configuredOrigins:(config.NODE_ENV==='development'?developmentOrigins:false),credentials:true});
  app.useGlobalPipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  adapter.getInstance().addHook('onSend',async(request,reply,payload)=>{
    // 鸿蒙微信 8.0.21 会把复用连接上的 POST 响应长期显示为 Pending，导致刷新令牌已在
    // 服务端轮换但客户端没有提交新会话。对小程序 POST 明确关闭连接，保证完成回调触发。
    if(request.method==='POST'&&request.headers['x-banda-client']==='mini-program')reply.header('Connection','close');
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('Referrer-Policy','no-referrer');
    reply.header('X-Frame-Options','DENY');
    reply.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    const scriptPolicy=request.url.startsWith('/api/docs')?"script-src 'self' 'unsafe-inline'":"script-src 'self'";
    reply.header('Content-Security-Policy',`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ${scriptPolicy}; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
    return payload;
  });

  const openApi = new DocumentBuilder()
    .setTitle('班达云服务企业 API')
    .setDescription('班达云服务新版企业管理、组织权限、设备和教学 API。')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('/api/docs', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(config.PORT, config.HOST);
  return app;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  bootstrap().catch(error => {
    const failure = error as NodeJS.ErrnoException & { hostname?:string };
    if (failure.code === 'ENOTFOUND' && failure.hostname === 'postgres') {
      console.error('[启动失败] DATABASE_URL 中的主机名 postgres 只能在 Docker Compose 网络内使用。');
    } else if (failure.code === 'ECONNREFUSED') {
      console.error('[启动失败] 无法连接 PostgreSQL，请确认数据库已经启动并检查 DATABASE_URL。');
    } else {
      console.error('[启动失败]', failure.message || failure);
    }
    process.exitCode = 1;
  });
}
