import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  AUTH_PROVIDER: z.enum(['dev', 'sms']).default('dev'),
  ALLOW_DEV_AUTH_IN_PRODUCTION: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast: a mis-configured server must never start.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

if (data.NODE_ENV === 'production' && data.AUTH_PROVIDER === 'dev' && !data.ALLOW_DEV_AUTH_IN_PRODUCTION) {
  console.error(
    'AUTH_PROVIDER=dev is a temporary development login and is refused in production. ' +
      'Configure AUTH_PROVIDER=sms, or set ALLOW_DEV_AUTH_IN_PRODUCTION=true to accept the risk.',
  );
  process.exit(1);
}

export const env = {
  ...data,
  isProd: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  corsOrigins: data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
