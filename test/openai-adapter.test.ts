import { describe, expect, it } from 'vitest';
import { translateOpenAIRequest, translateOpenAIResponse } from 'unified-llm-client';

describe('LLMlibrary OpenAI adapter patch', () => {
  it('serializes assistant history as output_text for follow-up turns', () => {
    const request = translateOpenAIRequest({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'Create a tic-tac-toe game.' },
      ],
      model: 'gpt-5.4',
    }) as {
      input: Array<{
        content: Array<{ type: string }>;
        role: string;
      }>;
    };

    expect(request.input).toMatchObject([
      { role: 'user', content: [{ type: 'input_text' }] },
      { role: 'assistant', content: [{ type: 'output_text' }] },
      { role: 'user', content: [{ type: 'input_text' }] },
    ]);
  });

  it('does not parse incomplete tool-call arguments as executable tool calls', () => {
    const response = translateOpenAIResponse(
      {
        id: 'resp_test',
        model: 'gpt-5.4',
        object: 'response',
        output: [
          {
            arguments: '{"file":"index.html","content":"<html>',
            call_id: 'call_test',
            id: 'fc_test',
            name: 'write_file',
            status: 'incomplete',
            type: 'function_call',
          },
        ],
        status: 'completed',
      },
      undefined,
      'gpt-5.4',
    );

    expect(response.finishReason).toBe('length');
    expect(response.toolCalls).toEqual([]);
  });
});
