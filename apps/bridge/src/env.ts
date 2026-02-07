import { z } from 'zod';

export const EnvSchema = z.object({
  OADM_HOME: z.string().optional(),
  OADM_PORT: z.coerce.number().default(8787),
  OADM_BIND: z.string().default('127.0.0.1'),
  OADM_DB_PATH: z.string().optional(),
  OADM_AUTH_TOKEN: z.string(),
  // Optional: used when creating invites
  OADM_AGENT_GATEWAY_URL: z.string().optional(),
  OADM_AGENT_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid env');
  }
  return parsed.data;
}
