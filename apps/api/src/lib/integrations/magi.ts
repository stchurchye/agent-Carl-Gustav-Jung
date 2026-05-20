const MAGI_SYSTEM_URL = process.env.MAGI_SYSTEM_URL?.trim();
const MAGI_CONTENT_URL = process.env.MAGI_CONTENT_URL?.trim();

export function magiContentEnabled(): boolean {
  return process.env.MAGI_CONTENT_ENABLED === '1' && Boolean(MAGI_CONTENT_URL);
}

export function magiSystemEnabled(): boolean {
  return process.env.MAGI_SYSTEM_ENABLED === '1' && Boolean(MAGI_SYSTEM_URL);
}

export async function queryMagiSystem(question: string): Promise<string> {
  if (!magiSystemEnabled()) {
    return 'MAGI 知识库未启用。请在服务端配置 MAGI_SYSTEM_ENABLED=1 与 MAGI_SYSTEM_URL。';
  }
  const res = await fetch(`${MAGI_SYSTEM_URL}/api/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_SYSTEM_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    throw new Error(`magi-system HTTP ${res.status}`);
  }
  const json = (await res.json()) as { answer?: string; text?: string };
  return json.answer ?? json.text ?? '（无回复）';
}

export async function ingestMagiContent(url: string): Promise<{
  title: string;
  summary: string;
  videoUrl?: string;
}> {
  if (!magiContentEnabled()) {
    return {
      title: '链接处理未启用',
      summary: `MAGI Content 未开启。链接：${url}`,
    };
  }
  const res = await fetch(`${MAGI_CONTENT_URL}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAGI_CONTENT_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(`magi-content HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    title?: string;
    summary?: string;
    videoUrl?: string;
  };
  return {
    title: json.title ?? '链接内容',
    summary: json.summary ?? '',
    videoUrl: json.videoUrl,
  };
}
