import React from 'react';
import { View, Text } from 'react-native';
import type { AgentTodo, AgentTodoStatus } from './types';
import { colors } from '../../theme/colors';

const ICON: Record<AgentTodoStatus, string> = {
  pending: '○',
  in_progress: '▷',
  completed: '✓',
  skipped: '–',
  failed: '✗',
};

function isFinished(status: AgentTodoStatus): boolean {
  return status === 'completed' || status === 'skipped' || status === 'failed';
}

export function AgentTodoList({ todos }: { todos: AgentTodo[] }) {
  if (!todos.length) return null;
  return (
    <View>
      {todos.map((t) => {
        const finished = isFinished(t.status);
        const failed = t.status === 'failed';
        return (
          <View
            key={t.id}
            style={{ flexDirection: 'row', paddingVertical: 4, alignItems: 'flex-start' }}
          >
            <Text
              style={{
                width: 18,
                color: failed ? colors.danger : t.status === 'in_progress' ? colors.link : colors.text,
              }}
            >
              {ICON[t.status]}
            </Text>
            <Text
              style={{
                flex: 1,
                marginLeft: 8,
                opacity: finished ? 0.55 : 1,
                color: failed ? colors.danger : undefined,
              }}
            >
              {t.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
