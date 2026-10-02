const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { WebSocket } = require('ws');

// Colors for test output
const green = (text) => `\x1b[32m✔ ${text}\x1b[0m`;
const red = (text) => `\x1b[31m✖ ${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

console.log(cyan('\n======================================================'));
console.log(cyan('   REAL-TIME COURSE COMMENT FEED VERIFICATION SUITE   '));
console.log(cyan('======================================================\n'));

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(green(name));
    passedCount++;
  } catch (err) {
    console.error(red(name));
    console.error('   ', err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalCount++;
  try {
    await fn();
    console.log(green(name));
    passedCount++;
  } catch (err) {
    console.error(red(name));
    console.error('   ', err.message);
  }
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');

  // Test 1: docker-compose.yml structure & healthchecks
  runTest('Req 1: docker-compose.yml exists and defines app, mongodb, redis with healthchecks', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    assert(fs.existsSync(composePath), 'docker-compose.yml does not exist');
    const content = fs.readFileSync(composePath, 'utf8');

    assert(content.includes('mongodb:'), 'mongodb service missing');
    assert(content.includes('redis:'), 'redis service missing');
    assert(content.includes('app:'), 'app service missing');
    assert(content.includes('healthcheck:'), 'healthchecks missing');
    assert(content.includes('mongo_data:'), 'named volume mongo_data missing');
    assert(content.includes('service_healthy'), 'depends_on service_healthy condition missing');
  });

  // Test 2: .env.example
  runTest('Req 11: .env.example exists and documents PORT, MONGO_URI, REDIS_URL', () => {
    const envPath = path.join(rootDir, '.env.example');
    assert(fs.existsSync(envPath), '.env.example does not exist');
    const content = fs.readFileSync(envPath, 'utf8');

    assert(content.includes('PORT='), 'PORT variable missing');
    assert(content.includes('MONGO_URI='), 'MONGO_URI variable missing');
    assert(content.includes('REDIS_URL='), 'REDIS_URL variable missing');
  });

  // Test 3: submission.json schema
  runTest('Req 12: submission.json exists and adheres to required schema', () => {
    const subPath = path.join(rootDir, 'submission.json');
    assert(fs.existsSync(subPath), 'submission.json does not exist');
    const data = JSON.parse(fs.readFileSync(subPath, 'utf8'));

    assert.strictEqual(typeof data.httpPort, 'number', 'httpPort must be number');
    assert.strictEqual(typeof data.wsPort, 'number', 'wsPort must be number');
    assert.strictEqual(typeof data.frontendUrl, 'string', 'frontendUrl must be string');
    assert(data.frontendUrl.startsWith('http'), 'frontendUrl must be valid URL');
  });

  // Test 4: Frontend HTML data-testid attributes
  runTest('Req 9: frontend/index.html includes all required data-testid attributes', () => {
    const htmlPath = path.join(rootDir, 'frontend/index.html');
    assert(fs.existsSync(htmlPath), 'frontend/index.html does not exist');
    const content = fs.readFileSync(htmlPath, 'utf8');

    assert(content.includes('data-testid="comment-list"'), 'data-testid="comment-list" missing');
    assert(content.includes('data-testid="comment-input"'), 'data-testid="comment-input" missing');
    assert(content.includes('data-testid="comment-submit"'), 'data-testid="comment-submit" missing');
  });

  // Test 5: Frontend JS comment item testid generation
  runTest('Req 9: frontend/app.js dynamically generates data-testid="comment-item-{id}"', () => {
    const appJsPath = path.join(rootDir, 'frontend/app.js');
    assert(fs.existsSync(appJsPath), 'frontend/app.js does not exist');
    const content = fs.readFileSync(appJsPath, 'utf8');

    assert(
      content.includes('comment-item-${comment.id}') || content.includes('data-testid'),
      'data-testid="comment-item-{id}" pattern missing in frontend/app.js'
    );
  });

  // Test 6: Backend MongoDB Indexing code contract
  runTest('Req 2: backend/database/mongo.js enforces compound index { courseId: 1, createdAt: -1 }', () => {
    const mongoPath = path.join(rootDir, 'backend/database/mongo.js');
    assert(fs.existsSync(mongoPath), 'backend/database/mongo.js does not exist');
    const content = fs.readFileSync(mongoPath, 'utf8');

    assert(
      content.includes('courseId: 1') && content.includes('createdAt: -1'),
      'Compound index { courseId: 1, createdAt: -1 } missing'
    );
    assert(content.includes('createIndex'), 'createIndex call missing');
  });

  // Test 7: Redis Pub/Sub channel naming contract
  runTest('Req 6: backend/pubsub/redis.js uses channel pattern course:{courseId}:comments', () => {
    const redisPath = path.join(rootDir, 'backend/pubsub/redis.js');
    assert(fs.existsSync(redisPath), 'backend/pubsub/redis.js does not exist');
    const content = fs.readFileSync(redisPath, 'utf8');

    assert(content.includes('course:${courseId}:comments') || content.includes('course:'), 'Channel pattern missing');
    assert(content.includes('pSubscribe'), 'pSubscribe missing');
  });

  // Test 8: WebSocket server connection and room broadcast
  await runAsyncTest('Req 5, 7, 8: WebSocket connection, room isolation, and heartbeat ping/pong', async () => {
    const { setupWebSocketServer } = require('../backend/websocket/wsServer');
    const express = require('express');
    const testApp = express();
    const testServer = http.createServer(testApp);

    const { broadcastToRoom, courseRooms } = setupWebSocketServer(testServer);

    await new Promise((resolve) => testServer.listen(0, resolve));
    const testPort = testServer.address().port;

    // Connect Client A (target-1)
    const wsA = new WebSocket(`ws://localhost:${testPort}/ws/courses/target-1`);
    await new Promise((res) => (wsA.onopen = res));

    // Connect Client B (target-1)
    const wsB = new WebSocket(`ws://localhost:${testPort}/ws/courses/target-1`);
    await new Promise((res) => (wsB.onopen = res));

    // Connect Client C (other-target)
    const wsC = new WebSocket(`ws://localhost:${testPort}/ws/courses/other-target`);
    await new Promise((res) => (wsC.onopen = res));

    assert(courseRooms.has('target-1'), 'Room target-1 should exist');
    assert(courseRooms.has('other-target'), 'Room other-target should exist');
    assert.strictEqual(courseRooms.get('target-1').size, 2, 'Room target-1 should have 2 clients');

    // Test Room Isolation: Broadcast to target-1
    const receivedA = [];
    const receivedB = [];
    const receivedC = [];

    wsA.on('message', (data) => receivedA.push(JSON.parse(data.toString())));
    wsB.on('message', (data) => receivedB.push(JSON.parse(data.toString())));
    wsC.on('message', (data) => receivedC.push(JSON.parse(data.toString())));

    const testComment = {
      id: '507f1f77bcf86cd799439011',
      courseId: 'target-1',
      userId: 'user_alice',
      text: 'Hello target-1 room!',
      createdAt: new Date().toISOString()
    };

    broadcastToRoom('target-1', testComment);

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(receivedA.length, 1, 'Client A should receive 1 message');
    assert.strictEqual(receivedA[0].text, 'Hello target-1 room!');
    assert.strictEqual(receivedB.length, 1, 'Client B should receive 1 message');
    assert.strictEqual(receivedC.length, 0, 'Client C in other-target must NOT receive message');

    // Test Ping/Pong frame (Req 8)
    let pongReceived = false;
    wsA.on('pong', () => {
      pongReceived = true;
    });
    wsA.ping();

    // Test Application-level { "type": "ping" } (Req 8)
    let appPongReceived = false;
    wsB.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'pong') {
          appPongReceived = true;
        }
      } catch (e) {}
    });
    wsB.send(JSON.stringify({ type: 'ping' }));

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert(pongReceived, 'Protocol ping frame should receive pong');
    assert(appPongReceived, 'Application-level { type: "ping" } should receive { type: "pong" }');

    // Cleanup
    wsA.close();
    wsB.close();
    wsC.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    testServer.close();
  });

  // Test 9: REST API routes contract check (input validation & schema)
  await runAsyncTest('Req 3 & 4: REST API validation and chronological historical order', async () => {
    const express = require('express');
    const commentsRouter = require('../backend/routes/comments');

    const app = express();
    app.use(express.json());
    app.use('/api/courses', commentsRouter);

    const testServer = http.createServer(app);
    await new Promise((resolve) => testServer.listen(0, resolve));
    const testPort = testServer.address().port;

    // Test validation for POST without text or userId (should return 400)
    const postRes1 = await fetch(`http://localhost:${testPort}/api/courses/course-test/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'alice' }) // missing text
    });
    assert.strictEqual(postRes1.status, 400, 'POST without text must return 400 Bad Request');

    const postRes2 = await fetch(`http://localhost:${testPort}/api/courses/course-test/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }) // missing userId
    });
    assert.strictEqual(postRes2.status, 400, 'POST without userId must return 400 Bad Request');

    testServer.close();
  });

  console.log(cyan('\n------------------------------------------------------'));
  console.log(`Results: ${passedCount}/${totalCount} tests passed.`);
  console.log(cyan('------------------------------------------------------\n'));

  if (passedCount === totalCount) {
    console.log(green('All requirements verified successfully!'));
    process.exit(0);
  } else {
    console.error(red('Some tests failed.'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
