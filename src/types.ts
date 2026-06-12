import type { CanonicalTool, JsonObject, JsonValue } from 'unified-llm-client';

export type { JsonObject, JsonValue };
export type ToolDefinition = CanonicalTool;

export interface AgentOptions {
  allowEdits: boolean;
  instructions?: string;
  maxOutputTokens: number;
  maxToolRounds: number;
  model: string;
  onEvent?: (event: AgentEvent) => void;
  projectRoot: string;
}

export type AgentEvent =
  | {
      round: number;
      type: 'model_request';
    }
  | {
      responseId?: string;
      round: number;
      toolCallCount: number;
      type: 'model_response';
    }
  | {
      args: JsonObject;
      name: string;
      round: number;
      type: 'tool_start';
    }
  | {
      name: string;
      ok: boolean;
      round: number;
      type: 'tool_finish';
    };
