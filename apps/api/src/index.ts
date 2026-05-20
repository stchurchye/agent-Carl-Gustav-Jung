import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isCorsOriginAllowed, parseCorsOrigins } from './lib/cors.js';
import { assertProductionConfig } from './lib/startup.js';
import { randomUUID } from 'crypto';
import { documentsRouter } from './routes/documents.js';
import { chatRouter } from './routes/chat.js';
import { settingsRouter } from './routes/settings.js';
import { ocrRouter } from './routes/ocr.js';
import { asrRouter } from './routes/asr.js';
import { ttsRouter } from './routes/tts.js';
import { authRouter } from './routes/auth.js';
import { groupsRouter } from './routes/groups.js';
import { groupChatRouter } from './routes/groupChat.js';
import { usersRouter } from './routes/users.js';
import { orchestrateRouter } from './routes/orchestrate.js';
import { btwRouter } from './routes/btw.js';
import { memoryRouter } from './routes/memory.js';
import { intentRouter } from './routes/intent.js';
import { agentRouter } from './routes/agent.js';
import { startAgentWorker } from './lib/agent/worker.js';
import { registerEchoSleep } from './lib/agent/tools/echoSleep.js';
import { llmLogsRouter } from './routes/llmLogs.js';
import { mediaRouter } from './routes/media.js';
import { XZZ_API_PORT } from '@xzz/shared';
import { requireDatabaseUrl } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { log } from './lib/logger.js';
import type { AppVariables } from './types.js';

const app = new Hono<{ Variables: AppVariables }>();

const corsOrigins = parseCorsOrigins();
app.use(
  '*',
  cors({
    origin: (origin) =>
      isCorsOriginAllowed(origin, corsOrigins) ? (origin ?? '*') : null,
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-DeepSeek-Api-Key',
      'X-ZenMux-Api-Key',
      'X-DashScope-Api-Key',
      'X-Reply-Dialect',
      'X-Chat-Llm-Model',
    ],
    exposeHeaders: ['X-Request-Id'],
  }),
);
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-Id') ?? randomUUID();
  c.set('requestId', requestId);
  const start = Date.now();
  await next();
  log('info', 'request', {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  });
});

app.get('/health', async (c) => {
  let dbOk = false;
  try {
    const { getPool } = await import('./db/client.js');
    await getPool().query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    ok: true,
    service: '行动中止派-api',
    db: dbOk,
    requestId: c.get('requestId'),
  });
});

app.route('/api/auth', authRouter);
app.route('/api/users', usersRouter);
app.route('/api/groups', groupsRouter);
app.route('/api/groups', groupChatRouter);
app.route('/api/documents', documentsRouter);
app.route('/api/chat', chatRouter);
app.route('/api/private/chat', chatRouter);
app.route('/api/orchestrate', orchestrateRouter);
app.route('/api/btw', btwRouter);
app.route('/api/memory', memoryRouter);
app.route('/api/intent', intentRouter);
app.route('/api/agent', agentRouter);
app.route('/api/llm-logs', llmLogsRouter);
app.route('/api/media', mediaRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/ocr', ocrRouter);
app.route('/api/asr', asrRouter);
app.route('/api/tts', ttsRouter);

async function main() {
  assertProductionConfig();
  requireDatabaseUrl();
  await runMigrations();
  registerEchoSleep();
  startAgentWorker({ concurrency: 1, intervalMs: 2_000 });
  const port = Number(process.env.PORT ?? XZZ_API_PORT);
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
    log('info', 'api.started', {
      port: info.port,
      url: `http://127.0.0.1:${info.port}`,
    });
  });
}

main().catch((e) => {
  console.error('[行动中止派-api] 启动失败', e);
  process.exit(1);
});

export default app;
