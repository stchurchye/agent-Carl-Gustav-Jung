import {
  AgentBudgetExhausted,
  type AgentBudget,
  type AgentUsage,
} from './types.js';

export function checkBudget(budget: AgentBudget, usage: AgentUsage): void {
  if (usage.steps >= budget.maxSteps) {
    throw new AgentBudgetExhausted('steps');
  }
  if (usage.elapsedSeconds >= budget.maxSeconds) {
    throw new AgentBudgetExhausted('seconds');
  }
  if (usage.tokens >= budget.maxTokens) {
    throw new AgentBudgetExhausted('tokens');
  }
}
