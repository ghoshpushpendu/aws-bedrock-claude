import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../utils/logger.js';

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

/**
 * Allowlist of Bedrock model IDs this proxy will forward to.
 * Extend as Anthropic releases new models on Bedrock.
 */
export const ALLOWED_MODELS = new Set([
  // Cross-region inference profiles (required for newer models)
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  'us.anthropic.claude-3-opus-20240229-v1:0',
  'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
  'eu.anthropic.claude-3-5-sonnet-20241022-v2:0',
  // Legacy on-demand model IDs (still work for older models)
  'anthropic.claude-3-7-sonnet-20250219-v1:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
  'anthropic.claude-3-opus-20240229-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
  'anthropic.claude-instant-v1',
]);

/**
 * Build the Bedrock request payload from an Anthropic-style messages request.
 */
function buildBedrockPayload(body, modelId) {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    messages: body.messages,
    max_tokens: body.max_tokens ?? 2048,
  };

  if (body.system) payload.system = body.system;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.top_k !== undefined) payload.top_k = body.top_k;
  if (body.stop_sequences) payload.stop_sequences = body.stop_sequences;

  return payload;
}

/**
 * Invoke Bedrock and return a Claude-shaped response object.
 */
export async function invokeModel(body, modelId) {
  const payload = buildBedrockPayload(body, modelId);

  logger.info('Invoking Bedrock model', { modelId });

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);
  const raw = JSON.parse(Buffer.from(response.body).toString('utf-8'));

  // Bedrock returns the same shape as the Anthropic API for Claude models,
  // so we mostly pass it through and ensure the model field is populated.
  return {
    id: raw.id ?? `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: raw.content ?? [],
    model: modelId,
    stop_reason: raw.stop_reason ?? null,
    stop_sequence: raw.stop_sequence ?? null,
    usage: raw.usage ?? {},
  };
}

/**
 * Invoke Bedrock with response streaming.
 * Yields Server-Sent Events strings compatible with the Anthropic streaming format.
 *
 * @param {object} body - The parsed request body
 * @param {string} modelId
 * @param {import('express').Response} res - Express response (for SSE flushing)
 */
export async function invokeModelStream(body, modelId, res) {
  const payload = buildBedrockPayload(body, modelId);

  logger.info('Invoking Bedrock model (stream)', { modelId });

  const command = new InvokeModelWithResponseStreamCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await client.send(command);

  // Emit the message_start event
  const messageId = `msg_${Date.now()}`;
  sendSSE(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: modelId,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  sendSSE(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });

  sendSSE(res, 'ping', { type: 'ping' });

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of response.body) {
    if (!chunk.chunk?.bytes) continue;

    const decoded = JSON.parse(Buffer.from(chunk.chunk.bytes).toString('utf-8'));

    if (decoded.type === 'content_block_delta') {
      sendSSE(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: decoded.index ?? 0,
        delta: decoded.delta,
      });
    } else if (decoded.type === 'message_delta') {
      outputTokens = decoded.usage?.output_tokens ?? outputTokens;
      sendSSE(res, 'message_delta', {
        type: 'message_delta',
        delta: decoded.delta,
        usage: decoded.usage,
      });
    } else if (decoded.type === 'message_start') {
      inputTokens = decoded.message?.usage?.input_tokens ?? inputTokens;
    }
  }

  sendSSE(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sendSSE(res, 'message_stop', { type: 'message_stop' });

  // Final done sentinel
  res.write('data: [DONE]\n\n');
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
