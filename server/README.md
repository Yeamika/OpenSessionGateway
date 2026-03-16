# OpenSessionGateway Server

Next.js 16 + TypeScript server for runtime monitoring and gateway control.

## Stack

- Next.js 16 + TypeScript
- PostgreSQL
- Redis
- shadcn/ui + Tailwind CSS v4

## Runtime Port

- Dev: `4088`
- Start: `4088`

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Ensure DB URL points to database `opensession_gateway`.
3. Generate Prisma client:

```bash
npx prisma generate
```

4. Run development server:

```bash
npm run dev
```

Open `http://localhost:4088`.

## API Endpoints

### HTTP Endpoints

- `GET /` (NancyMonitor)
- `GET /api/health`
- `GET /api/nancymonitor/stream`
- `GET /api/v2/mcp/session_gateway`
- `POST /api/v2/mcp/session_gateway`
- `GET /api/v2/mcp/gateway_client_control`
- `POST /api/v2/mcp/gateway_client_control`
- `GET /api/v2/mcp/timer_scheduler`
- `POST /api/v2/mcp/timer_scheduler`

### WebSocket

- `ws://<host>:4088/api/v2/wsport`
