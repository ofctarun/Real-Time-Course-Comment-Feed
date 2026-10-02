/**
 * Robust Reconnecting WebSocket Client with Exponential Backoff
 * and Ping/Pong heartbeat support
 */
class CourseWebSocketClient {
  constructor(courseId, options = {}) {
    this.courseId = courseId;
    this.onMessage = options.onMessage || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.reconnectTimeout = 1000;
    this.maxReconnectTimeout = 10000;
    this.ws = null;
    this.isExplicitlyClosed = false;
    this.heartbeatTimer = null;

    this.connect();
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/courses/${encodeURIComponent(this.courseId)}`;
  }

  connect() {
    if (this.isExplicitlyClosed) return;

    const url = this.getWebSocketUrl();
    this.onStatusChange('connecting', 'Connecting to real-time feed...');

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log(`[WS] Connected to course: ${this.courseId}`);
        this.reconnectTimeout = 1000; // Reset backoff
        this.onStatusChange('connected', 'Live Connected');
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Ignore pong heartbeats
          if (data && data.type === 'pong') {
            return;
          }
          this.onMessage(data);
        } catch (err) {
          console.warn('[WS] Received non-JSON or unparseable frame:', event.data);
        }
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        if (this.isExplicitlyClosed) return;

        console.log(`[WS] Connection lost (code ${event.code}). Reconnecting in ${this.reconnectTimeout}ms...`);
        this.onStatusChange('disconnected', `Reconnecting in ${(this.reconnectTimeout / 1000).toFixed(1)}s...`);

        setTimeout(() => this.connect(), this.reconnectTimeout);
        this.reconnectTimeout = Math.min(this.reconnectTimeout * 1.5, this.maxReconnectTimeout);
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] Socket error:', err);
      };
    } catch (e) {
      console.error('[WS] Connection attempt failed:', e);
      setTimeout(() => this.connect(), this.reconnectTimeout);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    // Send application-level ping every 25 seconds
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  close() {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange('disconnected', 'Disconnected');
  }
}

window.CourseWebSocketClient = CourseWebSocketClient;
