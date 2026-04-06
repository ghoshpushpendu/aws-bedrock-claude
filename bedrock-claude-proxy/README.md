# bedrock-claude-proxy

An Anthropic-compatible API proxy that forwards requests to **AWS Bedrock Claude models**.  
Drop it in front of any client that speaks the Anthropic Messages API — Claude Code, Zed, LiteLLM, etc. — and it will transparently route traffic to Bedrock.

---

## Features

- `POST /v1/messages` — standard inference (Anthropic-compatible response shape)
- `POST /v1/messages/stream` — Server-Sent Events streaming
- `GET /health` — unauthenticated health check
- API-key authentication (`x-api-key` or `Authorization: Bearer`)
- Rate limiting: 30 req/min per IP
- Model ID allowlist
- Max body size 5 MB, max 100 messages per request
- Structured JSON logging (key prefix only — never full key)
- CORS support
- Production-safe error handling (no stack traces leaked)

---

## Requirements

- Node.js ≥ 18
- An AWS account with Bedrock access enabled for the Claude model(s) you want to use
- AWS credentials with the `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` permissions

---

## Installation

```bash
git clone https://github.com/your-org/bedrock-claude-proxy.git
cd bedrock-claude-proxy
npm install
```

---

## Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

`.env.example`:

```env
PORT=3000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
MODEL_ID=anthropic.claude-3-7-sonnet-20250219-v1:0
API_KEYS=dev1-key,dev2-key,prod-key
NODE_ENV=development
```

| Variable              | Required | Description                                      |
|-----------------------|----------|--------------------------------------------------|
| `PORT`                | No       | HTTP port (default `3000`)                       |
| `AWS_REGION`          | Yes      | AWS region where Bedrock is enabled              |
| `AWS_ACCESS_KEY_ID`   | Yes*     | AWS access key (* or use IAM role)               |
| `AWS_SECRET_ACCESS_KEY` | Yes*   | AWS secret key (* or use IAM role)               |
| `MODEL_ID`            | Yes      | Default Bedrock model ID                         |
| `API_KEYS`            | Yes      | Comma-separated proxy API keys for clients       |
| `NODE_ENV`            | No       | Set to `production` to hide error details        |

> **Tip:** On AWS (EC2, ECS, Lambda, etc.) you can omit the key variables and attach an IAM role with the required Bedrock permissions instead.

---

## Running locally

```bash
# Development (auto-restarts on file change — Node ≥ 18.11)
npm run dev

# Production
npm start
```

---

## curl examples

### Standard inference

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev1-key" \
  -d '{
    "model": "anthropic.claude-3-7-sonnet-20250219-v1:0",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "max_tokens": 256
  }'
```

### Streaming inference

```bash
curl -X POST http://localhost:3000/v1/messages/stream \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev1-key" \
  -N \
  -d '{
    "messages": [{"role": "user", "content": "Count from 1 to 5."}],
    "max_tokens": 256
  }'
```

### Health check

```bash
curl http://localhost:3000/health
# {"ok":true}
```

---

## Client configuration

### Claude Code (`~/.claude/settings.json`)

```json
{
  "apiUrl": "http://localhost:3000",
  "apiKey": "dev1-key"
}
```

Or use the environment variable approach:

```bash
ANTHROPIC_BASE_URL=http://localhost:3000 \
ANTHROPIC_API_KEY=dev1-key \
claude
```

### Zed (`~/.config/zed/settings.json`)

```json
{
  "assistant": {
    "default_model": {
      "provider": "anthropic",
      "model": "claude-3-7-sonnet-20250219"
    },
    "anthropic": {
      "api_url": "http://localhost:3000",
      "api_key": "dev1-key"
    },
    "version": "2"
  }
}
```

---

## Docker

### Build and run

```bash
docker build -t bedrock-claude-proxy .

docker run -d \
  --name bedrock-proxy \
  -p 3000:3000 \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=your_key \
  -e AWS_SECRET_ACCESS_KEY=your_secret \
  -e MODEL_ID=anthropic.claude-3-7-sonnet-20250219-v1:0 \
  -e API_KEYS=prod-key \
  -e NODE_ENV=production \
  bedrock-claude-proxy
```

---

## Nginx reverse proxy

Copy `nginx.conf` to `/etc/nginx/sites-available/bedrock-proxy` and update the `server_name` and TLS certificate paths.  
Use [Certbot](https://certbot.eff.org/) to provision a free Let's Encrypt certificate:

```bash
sudo certbot --nginx -d your-domain.com
```

---

## Deployment

### Render

1. Create a new **Web Service** and connect your repo.
2. Set **Build Command** to `npm install`.
3. Set **Start Command** to `npm start`.
4. Add all environment variables in the Render dashboard.
5. Render auto-assigns a public HTTPS URL.

### Fly.io

```bash
# Install flyctl: https://fly.io/docs/getting-started/installing-flyctl/
fly launch --name bedrock-claude-proxy
fly secrets set \
  AWS_REGION=us-east-1 \
  AWS_ACCESS_KEY_ID=your_key \
  AWS_SECRET_ACCESS_KEY=your_secret \
  MODEL_ID=anthropic.claude-3-7-sonnet-20250219-v1:0 \
  API_KEYS=prod-key \
  NODE_ENV=production
fly deploy
```

### DigitalOcean App Platform

1. Push the repo to GitHub.
2. Create a new **App** in the DigitalOcean control panel → select your repo.
3. Choose **Node.js** as the environment.
4. Set **Run Command** to `npm start`.
5. Add environment variables in the **Environment Variables** section.
6. DigitalOcean assigns a public HTTPS URL automatically.

### Railway

```bash
# Install Railway CLI: https://railway.app/
railway login
railway init
railway up
# Then set env vars in the Railway dashboard or:
railway variables set AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=... \
  AWS_SECRET_ACCESS_KEY=... MODEL_ID=... API_KEYS=... NODE_ENV=production
```

---

## AWS IAM policy

Minimum permissions required:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.*"
    }
  ]
}
```

---

## Supported models

The proxy maintains an allowlist in `services/bedrock.js` (`ALLOWED_MODELS`).  
Currently includes:

- `anthropic.claude-3-7-sonnet-20250219-v1:0`
- `anthropic.claude-3-5-sonnet-20241022-v2:0`
- `anthropic.claude-3-5-haiku-20241022-v1:0`
- `anthropic.claude-3-opus-20240229-v1:0`
- `anthropic.claude-3-sonnet-20240229-v1:0`
- `anthropic.claude-3-haiku-20240307-v1:0`
- `anthropic.claude-instant-v1`

Add new model IDs to the `ALLOWED_MODELS` Set in `services/bedrock.js` as they become available.

---

## License

MIT
