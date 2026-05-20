import { describe, expect, it } from 'vitest';
import { parseChatMessageContent } from './parseMessageContent.js';

describe('parseChatMessageContent', () => {
  it('parses code and mermaid fences', () => {
    const raw = `前言\n\`\`\`js\nconsole.log(1)\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\n  A-->B\n\`\`\``;
    const blocks = parseChatMessageContent(raw);
    expect(blocks).toEqual([
      { type: 'text', text: '前言\n' },
      { type: 'code', language: 'js', code: 'console.log(1)' },
      { type: 'text', text: '\n\n' },
      { type: 'mermaid', code: 'graph LR\n  A-->B' },
    ]);
  });

  it('parses fence when language line has no trailing newline', () => {
    const raw = '```mermaid\ngraph LR\n  A-->B\n```';
    const blocks = parseChatMessageContent(raw);
    expect(blocks).toEqual([{ type: 'mermaid', code: 'graph LR\n  A-->B' }]);
  });

  it('normalizes CRLF line endings', () => {
    const raw = '```js\r\nx=1\r\n```';
    expect(parseChatMessageContent(raw)).toEqual([
      { type: 'code', language: 'js', code: 'x=1' },
    ]);
  });
});
