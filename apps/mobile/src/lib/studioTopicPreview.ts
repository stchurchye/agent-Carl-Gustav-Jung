import type { Topic } from '@xzz/shared';
import { api } from './api';
import { zh } from '../locales/zh-CN';

export type TopicPreviewRow = {
  topicId: string;
  topicTitle: string;
  preview: string;
  time?: string;
};

export async function loadGroupTopicPreviews(groupId: string): Promise<TopicPreviewRow[]> {
  const topicsRes = await api.listTopics(groupId);
  const enriched = await Promise.all(
    topicsRes.data.map(async (topic: Topic) => {
      try {
        const msgsRes = await api.listGroupMessages(groupId, topic.id);
        const last = msgsRes.data[msgsRes.data.length - 1];
        if (!last) {
          return {
            topicId: topic.id,
            topicTitle: topic.title,
            preview: zh.studio.topicNoMessagesYet,
            time: topic.updatedAt,
          };
        }
        const author = last.authorDisplayName?.trim() || (last.kind === 'ai' ? 'AI' : '成员');
        const body = last.content?.trim() || zh.studio.noMessagesYet;
        return {
          topicId: topic.id,
          topicTitle: topic.title,
          preview: `${author}: ${body}`,
          time: last.createdAt,
        };
      } catch {
        return {
          topicId: topic.id,
          topicTitle: topic.title,
          preview: zh.studio.topicNoMessagesYet,
          time: topic.updatedAt,
        };
      }
    }),
  );
  enriched.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
  return enriched;
}
