export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonObject;
  execute(args: JsonObject): Promise<JsonValue>;
}

export interface AgentOptions {
  allowEdits: boolean;
  instructions?: string;
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
