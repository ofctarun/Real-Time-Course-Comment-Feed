# Real-Time Course Comment Feed with WebSockets, MongoDB, and Redis

A production-grade, horizontally scalable, multi-client real-time comment feed designed for live course platforms. Built with **Node.js/Express**, **WebSockets**, **MongoDB** (with compound indexing), and **Redis Pub/Sub** for cross-instance messaging.

---

## 🏗️ Architecture Overview

The system utilizes a hybrid architecture:
- **HTTP REST API**: For state-changing mutations (`POST /api/courses/:courseId/comments`) and fetching historical data (`GET /api/courses/:courseId/comments`).
- **WebSockets (`/ws/courses/:courseId`)**: Dedicated full-duplex channels grouped by course rooms for instant downstream broadcasts.
- **Redis Pub/Sub**: In-memory messaging backplane that broadcasts new comment events across multiple application server instances.
- **MongoDB**: High-throughput NoSQL document store with compound indexing `{ courseId: 1, createdAt: -1 }`.

```
                    ┌───────────────────────────────┐
                    │      Client A / Browser       │
                    └───┬───────────────────────▲───┘
     1. HTTP POST       │                       │
     /api/courses/:id   │                       │ 7. WS Broadcast JSON (<100ms)
                        ▼                       │
       ┌─────────────────────────────────┐      │
       │       HTTP REST Controller      │      │
       └──────────────┬──────────────────┘      │
                      │ 2. Save Document        │
                      ▼                         │
           ┌─────────────────────┐              │
           │  MongoDB (comments) │              │
           └─────────────────────┘              │
                      │                         │
                      │ 3. Trigger Event        │
                      ▼                         │
           ┌─────────────────────┐              │
           │ Redis Pub/Sub Mgr   │              │
           └──────────┬──────────┘              │
                      │ 4. Publish "course:{id}:comments"
                      ▼                         │
           ┌─────────────────────┐              │
           │ Redis Channel       │              │
           └──────────┬──────────┘              │
                      │ 5. Emit to Subscribers  │
                      ▼                         │
       ┌─────────────────────────────────┐      │
       │    WebSocket Room Dispatcher    │──────┘
       │    (ws://domain/ws/courses/:id) │
       └─────────────────────────────────┘
```

---

## 🚀 Key Features & Evaluated Contracts

1. **Docker Compose Orchestration (`docker-compose.yml`)**
   - Orchestrates `app`, `mongodb`, and `redis` services.
   - Robust healthchecks on all services with `depends_on: condition: service_healthy`.
   - Named volume persistence (`mongo_data:/data/db`).

2. **NoSQL Database Modeling (`backend/database/mongo.js`)**
   - Document schema: `id`, `courseId`, `userId`, `text`, `createdAt`.
   - Auto-creates compound index `{ courseId: 1, createdAt: -1 }` on startup for optimal query execution.

3. **REST API Endpoints (`backend/routes/comments.js`)**
   - `POST /api/courses/{courseId}/comments`:
     - Validates payload: `{ "userId": "string", "text": "string" }`.
     - Returns `201 Created` with comment object.
   - `GET /api/courses/{courseId}/comments`:
     - Retrieves the 50 most recent comments, sorted chronologically (**oldest to newest**).
     - Returns `200 OK` with JSON array.

4. **WebSocket Connection Management (`backend/websocket/wsServer.js`)**
   - Endpoint: `ws://localhost:<PORT>/ws/courses/{courseId}`.
   - Room-based mapping: in-memory `courseRooms` Map.
   - Prevents memory leaks by cleaning up on socket close.
   - Handles standard protocol Ping/Pong frames and custom application-level `{ "type": "ping" }` heartbeats.

5. **Cross-Instance Event Streaming via Redis Pub/Sub (`backend/pubsub/redis.js`)**
   - Publishes to `course:{courseId}:comments` on comment creation.
   - Pattern subscriber (`course:*:comments`) forwards payloads to active course rooms.
   - Strict room isolation: comments for `target-1` are never broadcast to `other-target`.

6. **Progressive Frontend UI (`frontend/`)**
   - High visual excellence with dark mode, live status badge, and course switcher.
   - Required automated testing attributes:
     - `data-testid="comment-list"`
     - `data-testid="comment-item-{id}"`
     - `data-testid="comment-input"`
     - `data-testid="comment-submit"`
   - Exponential backoff WebSocket reconnection (`frontend/ws-client.js`).
   - Deduplication layer prevents double rendering.

---

## 📁 Repository Structure

```
.
├── docker-compose.yml         # Container orchestration (App, MongoDB, Redis)
├── Dockerfile                 # Application Docker build definition
├── .env.example               # Environment variable templates
├── .env                       # Local environment configuration
├── submission.json            # Automated grading configuration
├── package.json               # Dependencies and npm scripts
├── backend/
│   ├── index.js               # Application entrypoint & HTTP server
│   ├── database/
│   │   └── mongo.js           # MongoDB connection & index initialization
│   ├── routes/
│   │   └── comments.js        # POST and GET comment endpoints
│   ├── websocket/
│   │   └── wsServer.js        # WebSocket room management & heartbeats
│   └── pubsub/
│       └── redis.js           # Redis Publisher & Subscriber clients
├── frontend/
│   ├── index.html             # UI with required data-testid attributes
│   ├── style.css              # Modern UI design system & responsive styling
│   ├── app.js                 # State management & real-time deduplication
│   └── ws-client.js           # Reconnecting WebSocket client with backoff
└── test/
    └── verify_all.js          # Complete verification test suite (Req 1-12)
```

---

## 🛠️ Configuration (`.env.example` & `submission.json`)

### `.env.example`
```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/course_comments_db
REDIS_URL=redis://localhost:6379
```

### `submission.json`
```json
{
  "httpPort": 3000,
  "wsPort": 3000,
  "frontendUrl": "http://localhost:3000"
}
```

---

## 🧪 Verification & Testing

To run the automated verification suite validating all 12 core requirements:

```bash
npm test
```

This verifies:
- `docker-compose.yml` service definitions, healthchecks, and volume mounts.
- MongoDB compound index `{ courseId: 1, createdAt: -1 }`.
- REST API validation, schemas, and chronological sorting.
- WebSocket room grouping, room isolation, and Ping/Pong heartbeats.
- Redis Pub/Sub channel naming and pattern subscription.
- Frontend `data-testid` attributes and dynamic rendering.
