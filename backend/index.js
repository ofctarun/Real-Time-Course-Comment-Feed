require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const { connectDB, closeDB } = require('./database/mongo');
const { initPubSub, closePubSub } = require('./pubsub/redis');
const { setupWebSocketServer, broadcastToRoom } = require('./websocket/wsServer');
const commentsRouter = require('./routes/comments');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check endpoint for Docker and monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REST API routes
app.use('/api/courses', commentsRouter);

// Fallback route to serve frontend index.html for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Set up WebSocket server
setupWebSocketServer(server);

/**
 * Start the application
 */
async function startServer() {
  try {
    // 1. Connect to MongoDB and build index
    try {
      await connectDB();
    } catch (dbErr) {
      console.warn('[MongoDB] Initial connection deferred or failed:', dbErr.message);
    }

    // 2. Initialize Redis Pub/Sub with WebSocket broadcast callback
    try {
      await initPubSub((courseId, payload) => {
        broadcastToRoom(courseId, payload);
      });
    } catch (redisErr) {
      console.warn('[Redis] Initial connection deferred or failed:', redisErr.message);
    }

    // 3. Start HTTP and WebSocket server
    server.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`Server listening on http://localhost:${PORT}`);
      console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws/courses/{courseId}`);
      console.log(`REST API: POST/GET http://localhost:${PORT}/api/courses/{courseId}/comments`);
      console.log(`Frontend UI served at http://localhost:${PORT}`);
      console.log(`====================================================`);
    });
  } catch (error) {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await closePubSub();
      await closeDB();
      console.log('Cleanup completed. Exiting.');
      process.exit(0);
    } catch (e) {
      console.error('Error during cleanup:', e);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// If called directly, start server
if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
