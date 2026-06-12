import OpenAI from 'openai';

import { createFileTools, jsonStringifyResult } from './fs-tools.js';
import type { AgentEvent, AgentOptions, JsonObject, JsonValue, ToolDefinition } from './types.js';

const DEFAULT_INSTRUCTIONS = [
  'You are a careful coding assistant operating on a local project.',
  'Inspect files before editing them.',
  'Use project-relative paths.',
  'Do not claim a file was changed unless the edit_file tool reports edited=true.',
  'When a write tool reports dryRun=true, explain the proposed change and tell the user to disable dry-run mode if they want it written.',
].join('\n');

type ResponseItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ text?: string; type?: string }>;
};

type ResponseLike = {
  id?: string;
  output?: ResponseItem[];
  output_text?: string;
};

export async function runOpenAICodingAgent(prompt: string, options: AgentOptions): Promise<string> {
  const client = new OpenAI();
  const toolDefinitions = createFileTools({
    allowEdits: options.allowEdits,
    projectRoot: options.projectRoot,
  });
  const toolsByName = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
  const tools = toolDefinitions.map(toOpenAITool);
  const input: Array<Record<string, unknown>> = [
    ...(options.history ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: 'user',
      content: prompt,
    },
  ];

  let finalText = '';

  for (let round = 0; round <= options.maxToolRounds; round += 1) {
    options.onEvent?.({ round, type: 'model_request' });
    const response = (await client.responses.create({
      model: options.model,
      instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
      input: input as never,
      tools: tools as never,
      tool_choice: 'auto',
      parallel_tool_calls: false,
    })) as ResponseLike;

    input.push(...(response.output ?? []));
    const toolCalls = (response.output ?? []).filter((item) => item.type === 'function_call');
    options.onEvent?.({
      responseId: response.id,
      round,
      toolCallCount: toolCalls.length,
      type: 'model_response',
    });

    if (toolCalls.length === 0) {
      finalText = extractText(response);
      break;
    }

    if (round === options.maxToolRounds) {
      throw new Error(`Exceeded max tool rounds (${options.maxToolRounds}).`);
    }

    for (const toolCall of toolCalls) {
      input.push(await executeToolCall(toolCall, toolsByName, round, options.onEvent));
    }
  }

  return finalText.trim();
}

function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  };
}

async function executeToolCall(
  toolCall: ResponseItem,
  toolsByName: Map<string, ToolDefinition>,
  round: number,
  onEvent: ((event: AgentEvent) => void) | undefined,
): Promise<Record<string, unknown>> {
  const callId = requireString(toolCall.call_id, 'tool call id');
  const name = requireString(toolCall.name, 'tool name');
  const tool = toolsByName.get(name);

  if (!tool) {
    return buildToolOutput(callId, {
      ok: false,
      error: `Unknown tool: ${name}`,
    });
  }

  try {
    const args = parseArguments(toolCall.arguments);
    onEvent?.({ args, name, round, type: 'tool_start' });
    const result = await tool.execute(args);
    onEvent?.({ name, ok: true, round, type: 'tool_finish' });
    return buildToolOutput(callId, {
      ok: true,
      result,
    });
  } catch (error) {
    onEvent?.({ name, ok: false, round, type: 'tool_finish' });
    return buildToolOutput(callId, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildToolOutput(callId: string, output: JsonValue): Record<string, unknown> {
  return {
    type: 'function_call_output',
    call_id: callId,
    output: jsonStringifyResult(output),
  };
}

function parseArguments(argumentsJson: string | undefined): JsonObject {
  if (!argumentsJson) {
    return {};
  }

  const parsed = JSON.parse(argumentsJson) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.');
  }

  return parsed as JsonObject;
}

function extractText(response: ResponseLike): string {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? '')
    .join('');
}

function requireString(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}
