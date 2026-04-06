import { Router } from 'express';
import { invokeModel, invokeModelStream, ALLOWED_MODELS } from '../services/bedrock.js';
import { logger } from '../utils/logger.js';

const router = Router();

const DEFAULT_MODEL = process.env.MODEL_ID || 'anthropic.claude-3-7-sonnet-20250219-v1:0';
const MAX_MESSAGES = 100;

/**
 * Validate an incoming messages request.
 * Returns an error object { status, body } or null if valid.
 */
function validateRequest(body) {
  if (!body.messages || !Array.isArray(body.messages)) {
    return { status: 400, body: { error: { type: 'invalid_request_error', message: '`messages` array is required.' } } };
  }
  if (body.messages.length === 0) {
    return { status: 400, body: { error: { type: 'invalid_request_error', message: '`messages` must not be empty.' } } };
  }
  if (body.messages.length > MAX_MESSAGES) {
    return {
      status: 400,
      body: {
        error: {
          type: 'invalid_request_error',
          message: `Too many messages. Maximum allowed is ${MAX_MESSAGES}.`,
        },
      },
    };
  }
  return null;
}

/**
 * Resolve and validate the model ID for this request.
 * Clients may pass `model` in the body to override the default;
 * the value must be in the allowlist.
 */
function resolveModel(body) {
  const requested = body.model || DEFAULT_MODEL;
  if (!ALLOWED_MODELS.has(requested)) {
    return { error: { type: 'invalid_request_error', message: `Model '${requested}' is not supported by this proxy.` } };
  }
  return { modelId: requested };
}

// POST /v1/messages — standard (non-streaming) inference
router.post('/', async (req, res, next) => {
  const validationError = validateRequest(req.body);
  if (validationError) {
    logger.request(req, validationError.status);
    return res.status(validationError.status).json(validationError.body);
  }

  const { error: modelError, modelId } = resolveModel(req.body);
  if (modelError) {
    logger.request(req, 400);
    return res.status(400).json({ error: modelError });
  }

  try {
    const result = await invokeModel(req.body, modelId);
    logger.request(req, 200);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /v1/messages/stream — streaming inference via Server-Sent Events
router.post('/stream', async (req, res, next) => {
  const validationError = validateRequest(req.body);
  if (validationError) {
    logger.request(req, validationError.status);
    return res.status(validationError.status).json(validationError.body);
  }

  const { error: modelError, modelId } = resolveModel(req.body);
  if (modelError) {
    logger.request(req, 400);
    return res.status(400).json({ error: modelError });
  }

  // Set SSE headers before streaming starts
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await invokeModelStream(req.body, modelId, res);
    logger.request(req, 200);
    res.end();
  } catch (err) {
    // Headers already sent — write an SSE error event then close
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
    logger.error('Streaming error', { message: err.message });
  }
});

export default router;
