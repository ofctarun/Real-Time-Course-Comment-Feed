const { WebSocketServer, WebSocket } = require('ws');

// In-memory mapping of courseId -> Set of active WebSocket instances
// Example: { "course-123": Set([ws1, ws2]), "course-456": Set([ws3]) }
const courseRooms = new Map();

/**
 * Extract courseId from WebSocket request URL
 * Matches /ws/courses/:courseId or /ws/courses/:courseId/
 */
function extractCourseId(url) {
  try {
    const pathname = new URL(url, 'http://localhost').pathname;
    const match = pathname.match(/^\/ws\/courses\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (err) {
    return null;
  }
}

/**
 * Initialize WebSocket Server attached to an HTTP server
 */
function setupWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade requests
  server.on('upgrade', (request, socket, head) => {
    const courseId = extractCourseId(request.url);

    if (!courseId) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, courseId);
    });
  });

  // Handle connection
  wss.on('connection', (ws, request, courseId) => {
    // Fallback if courseId was not passed in emit
    if (!courseId) {
      courseId = extractCourseId(request.url);
    }

    if (!courseId) {
      ws.close(1008, 'Course ID required');
      return;
    }

    // Add to room
    if (!courseRooms.has(courseId)) {
      courseRooms.set(courseId, new Set());
    }
    courseRooms.get(courseId).add(ws);

    ws.courseId = courseId;
    ws.isAlive = true;

    // Protocol-level pong handler
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Protocol-level ping handler: respond with pong frame
    ws.on('ping', (data) => {
      ws.isAlive = true;
      ws.pong(data);
    });

    // Handle application-level ping/pong or other messages
    ws.on('message', (rawMessage, isBinary) => {
      try {
        const text = isBinary ? rawMessage.toString() : rawMessage;
        const msg = JSON.parse(text);

        // Application-level heartbeat support
        if (msg && msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        // Not a JSON heartbeat message, ignore
      }
    });

    // Cleanup on close to prevent memory leaks
    ws.on('close', () => {
      cleanUpSocket(ws, courseId);
    });

    ws.on('error', (err) => {
      console.error(`[WebSocket] Error for course ${courseId}:`, err.message);
      cleanUpSocket(ws, courseId);
    });
  });

  // Periodic heartbeat interval to drop silent connection failures
  const heartbeatInterval = setInterval(() => {
    for (const [courseId, clients] of courseRooms.entries()) {
      for (const ws of clients) {
        if (ws.isAlive === false) {
          cleanUpSocket(ws, courseId);
          ws.terminate();
          continue;
        }

        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30000);
  heartbeatInterval.unref();

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return { wss, courseRooms, broadcastToRoom };
}

/**
 * Remove socket from room and remove room if empty
 */
function cleanUpSocket(ws, courseId) {
  const room = courseRooms.get(courseId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      courseRooms.delete(courseId);
    }
  }
}

/**
 * Broadcast payload to all open WebSockets subscribed to a specific courseId
 */
function broadcastToRoom(courseId, message) {
  const room = courseRooms.get(String(courseId));
  if (!room || room.size === 0) {
    return 0;
  }

  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  let sentCount = 0;

  for (const client of room) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sentCount++;
    }
  }

  return sentCount;
}

module.exports = {
  setupWebSocketServer,
  broadcastToRoom,
  courseRooms
};
