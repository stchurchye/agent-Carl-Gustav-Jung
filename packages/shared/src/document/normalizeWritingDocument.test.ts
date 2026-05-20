import { describe, expect, it } from 'vitest';
import type { Document } from '../types.js';
import { normalizeWritingDocument } from './normalizeWritingDocument.js';

function baseDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    title: '测试',
    chapters: [],
    globalSummary: '',
    styleGuide: '',
    currentRevisionId: null,
    revisionCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeWritingDocument', () => {
  it('adds a chapter and block when document is empty', () => {
    const { doc, changed } = normalizeWritingDocument(baseDoc());
    expect(changed).toBe(true);
    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0]?.blocks).toHaveLength(1);
    expect(doc.chapters[0]?.blocks[0]?.id).toBeTruthy();
  });

  it('adds block when chapter has no blocks', () => {
    const { doc, changed } = normalizeWritingDocument(
      baseDoc({
        chapters: [
          {
            id: 'ch-1',
            title: '段·1',
            order: 0,
            chapterSummary: '',
            blocks: [],
          },
        ],
      }),
    );
    expect(changed).toBe(true);
    expect(doc.chapters[0]?.blocks).toHaveLength(1);
  });

  it('is stable when document already has a block', () => {
    const input = baseDoc({
      chapters: [
        {
          id: 'ch-1',
          title: '段·1',
          order: 0,
          chapterSummary: '',
          blocks: [{ id: 'blk-1', content: 'hello', currentRevisionId: null }],
        },
      ],
    });
    const first = normalizeWritingDocument(input);
    const second = normalizeWritingDocument(first.doc);
    expect(first.changed).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.doc.chapters[0]?.blocks[0]?.id).toBe('blk-1');
  });
});
