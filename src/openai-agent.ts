import {
  LLMClient,
  ModelRegistry,
  SlidingWindowStrategy,
  type CanonicalTool,
  type Conversation,
  type JsonObject,
  type JsonValue,
  type ModelInfo,
} from 'unified-llm-client';

import { createFileTools } from './fs-tools.js';
import type { AgentEvent, AgentOptions } from './types.js';

const DEFAULT_INSTRUCTIONS = [
  'You are a careful coding assistant operating on a local project.',
  'Inspect files before editing them.',
  'Use project-relative paths.',
  'Do not claim a file was changed unless the tool result confirms it.',
  'When a write tool reports dryRun=true, explain the proposed change and tell the user to disable dry-run mode if they want it written.',
].join('\n');

export interface CodingAgentSession {
  clear(): void;
  messageCount(): number;
  send(prompt: string): Promise<string>;
}

export async function createCodingAgentSession(options: AgentOptions): Promise<CodingAgentSession> {
  const modelRegistry = new ModelRegistry();
  ensureModelRegistered(modelRegistry, options.model);

  const client = LLMClient.fromEnv({
    defaultModel: options.model,
    modelRegistry,
  });
  const tools = instrumentTools(
    createFileTools({
      allowEdits: () => options.allowEdits,
      projectRoot: options.projectRoot,
    }),
    options.onEvent,
  );
  const conversation = await client.conversation({
    contextManager: new SlidingWindowStrategy({
      maxMessages: 30,
      maxTokens: 64_000,
    }),
    maxTokens: options.maxOutputTokens,
    maxToolRounds: options.maxToolRounds,
    model: options.model,
    system: options.instructions ?? DEFAULT_INSTRUCTIONS,
    tools,
  });

  return {
    clear() {
      conversation.clear();
    },
    messageCount() {
      return conversation.history.length;
    },
    async send(prompt: string): Promise<string> {
      options.onEvent?.({ round: 0, type: 'model_request' });
      const response = await conversation.send(prompt);
      options.onEvent?.({
        responseId: response.raw && typeof response.raw === 'object' && 'id' in response.raw
          ? String((response.raw as { id?: unknown }).id)
          : undefined,
        round: 0,
        toolCallCount: response.toolCalls.length,
        type: 'model_response',
      });
      return response.text.trim();
    },
  };
}

export async function runOpenAICodingAgent(prompt: string, options: AgentOptions): Promise<string> {
  const session = await createCodingAgentSession(options);
  return session.send(prompt);
}

function instrumentTools(
  tools: CanonicalTool[],
  onEvent: ((event: AgentEvent) => void) | undefined,
): CanonicalTool[] {
  if (!onEvent) {
    return tools;
  }

  return tools.map((tool) => {
    if (!tool.execute) {
      return tool;
    }

    return {
      ...tool,
      async execute(args: JsonObject, context) {
        onEvent({ args, name: tool.name, round: 0, type: 'tool_start' });
        try {
          const result = await tool.execute!(args, context);
          onEvent({ name: tool.name, ok: true, round: 0, type: 'tool_finish' });
          return result;
        } catch (error) {
          onEvent({ name: tool.name, ok: false, round: 0, type: 'tool_finish' });
          throw error;
        }
      },
    };
  });
}

function ensureModelRegistered(modelRegistry: ModelRegistry, model: string): void {
  if (modelRegistry.isSupported(model)) {
    return;
  }

  modelRegistry.register({
    contextWindow: 128_000,
    id: model,
    inputPrice: 0,
    kind: 'completion',
    lastUpdated: new Date().toISOString().slice(0, 10),
    outputPrice: 0,
    provider: inferProvider(model),
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
  });
}

function inferProvider(model: string): ModelInfo['provider'] {
  if (model.startsWith('claude-')) {
    return 'anthropic';
  }

  if (model.startsWith('gemini-')) {
    return 'google';
  }

  return 'openai';
}
