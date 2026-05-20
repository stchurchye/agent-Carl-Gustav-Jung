import type { Revision } from '@xzz/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { GroupStackParamList } from '../navigation/types';

export type OpenDiffPreviewOptions = {
  comment?: string;
  retryAction?: string;
  retryInstruction?: string;
  feedbackHistory?: string[];
  /** 已保持原样：仅查看对比 */
  viewOnly?: boolean;
};

/** 从历史或写作页打开「看看建议」 */
export function openDiffPreview(
  navigation: NativeStackNavigationProp<GroupStackParamList>,
  documentId: string,
  rev: Revision,
  options?: OpenDiffPreviewOptions,
) {
  navigation.navigate('DiffPreview', {
    documentId,
    revisionId: rev.id,
    blockId: rev.blockId ?? '',
    oldText: rev.previousSnapshot ?? '',
    newText: rev.snapshot,
    comment: options?.comment ?? rev.summary,
    createdAt: rev.createdAt,
    retryAction: options?.retryAction ?? '润色',
    retryInstruction: options?.retryInstruction ?? '',
    feedbackHistory: options?.feedbackHistory ?? [],
    viewOnly: options?.viewOnly,
  });
}
