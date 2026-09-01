import { z } from 'zod';

const trustProxyValue = z.string().default('loopback').transform(value => value === 'false' ? false : value === 'true' ? true : value);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  KEY_PEPPER: z.string().min(32),
  SETUP_TOKEN: z.string().min(16),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRUST_PROXY: trustProxyValue,
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default(''),
  ADMIN_WEB_ROOT: z.string().default(''),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && !value.PUBLIC_URL.startsWith('https://')) {
    context.addIssue({ code:'custom', path:['PUBLIC_URL'], message:'生产环境 PUBLIC_URL 必须使用 HTTPS' });
  }
  if(value.NODE_ENV==='production'&&value.TRUST_PROXY===true){
    context.addIssue({code:'custom',path:['TRUST_PROXY'],message:'生产环境不能信任任意代理，请配置明确的代理网段'});
  }
});

export type CloudConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  return schema.parse(env);
}
