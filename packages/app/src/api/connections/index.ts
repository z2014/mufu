import { z } from 'zod';

import { DaemonError, rpc } from '@/api/client';

export { DaemonError };

const checkItemSchema = z.object({
  name: z.enum(['installed', 'logged_in', 'subscription']),
  ok: z.boolean(),
  detail: z.string(),
  fix: z.string().nullable(),
});

const toolSchema = z.object({
  name: z.enum(['codex', 'claude', 'gh']),
  path: z.string().nullable(),
  installed: z.boolean(),
  loggedIn: z.boolean(),
  subscription: z.boolean().nullable(),
  items: z.array(checkItemSchema),
});

const doctorSchema = z.object({
  tools: z.array(toolSchema),
  ignoredEnvKeys: z.array(z.string()),
  configKeys: z.array(
    z.object({
      tool: z.enum(['codex', 'claude']),
      file: z.string(),
      key: z.string(),
    }),
  ),
  note: z.string(),
});

const secretStatusSchema = z.object({
  openrouter: z.boolean(),
});

type DoctorReport = z.infer<typeof doctorSchema>;
type SecretStatus = z.infer<typeof secretStatusSchema>;

export const connectionKeys = {
  doctor: ['connections', 'doctor'] as const,
  secret: ['connections', 'secret'] as const,
};

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DaemonError(`${label}的形状不对`);
  return parsed.data;
}

export async function fetchDoctor(): Promise<DoctorReport> {
  return parse(doctorSchema, await rpc('doctor'), '检查');
}

export async function fetchSecretStatus(): Promise<SecretStatus> {
  return parse(secretStatusSchema, await rpc('secret.status'), '钥匙');
}

export async function setOpenRouterKey(value: string): Promise<void> {
  const result = await rpc('secret.set', { account: 'openrouter', value });
  parse(z.object({ account: z.literal('openrouter'), set: z.literal(true) }), result, '钥匙');
}

export async function removeOpenRouterKey(): Promise<void> {
  const result = await rpc('secret.remove', { account: 'openrouter' });
  parse(z.object({ account: z.literal('openrouter'), set: z.literal(false) }), result, '钥匙');
}
