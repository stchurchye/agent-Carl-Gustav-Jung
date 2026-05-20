import { describe, expect, it } from 'vitest';
import { checkBudget } from '../budget.js';
import {
  AgentBudgetExhausted,
  type AgentBudget,
  type AgentUsage,
} from '../types.js';

const B: AgentBudget = { maxSteps: 5, maxSeconds: 60, maxTokens: 1000 };

function u(p: Partial<AgentUsage>): AgentUsage {
  return { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0, ...p };
}

describe('checkBudget', () => {
  it('passes under all limits', () => {
    expect(() => checkBudget(B, u({ steps: 2, elapsedSeconds: 10, tokens: 100 }))).not.toThrow();
  });

  it('throws on steps overflow', () => {
    expect(() => checkBudget(B, u({ steps: 5 }))).toThrow(AgentBudgetExhausted);
    expect(() => checkBudget(B, u({ steps: 5 }))).toThrow(/steps/);
  });

  it('throws on seconds overflow', () => {
    expect(() => checkBudget(B, u({ elapsedSeconds: 60 }))).toThrow(/seconds/);
  });

  it('throws on tokens overflow', () => {
    expect(() => checkBudget(B, u({ tokens: 1000 }))).toThrow(/tokens/);
  });
});
