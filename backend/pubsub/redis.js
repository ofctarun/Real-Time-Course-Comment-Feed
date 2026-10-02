const { createClient } = require('redis');

let publisher = null;
let subscriber = null;

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/**
 * Initialize Redis Publisher and Subscriber
 * @param {Function} onMessageCallback - Callback(courseId, payload) called when subscriber receives event
 */
async function initPubSub(onMessageCallback, redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL) {
  try {
    // 1. Publisher connection
    publisher = createClient({ url: redisUrl });
    publisher.on('error', (err) => console.error('[Redis Publisher] Error:', err.message));
    await publisher.connect();
    console.log('[Redis Publisher] Connected successfully.');

    // 2. Subscriber connection
    subscriber = createClient({ url: redisUrl });
    subscriber.on('error', (err) => console.error('[Redis Subscriber] Error:', err.message));
    await subscriber.connect();
    console.log('[Redis Subscriber] Connected successfully.');

    // Subscribe to pattern: course:*:comments
    await subscriber.pSubscribe('course:*:comments', (message, channel) => {
      try {
        // Channel format: "course:<courseId>:comments"
        const parts = channel.split(':');
        const courseId = parts[1];
        const payload = JSON.parse(message);

        if (typeof onMessageCallback === 'function') {
          onMessageCallback(courseId, payload);
        }
      } catch (err) {
        console.error('[Redis Subscriber] Failed to process message:', err.message);
      }
    });

    console.log('[Redis Subscriber] Subscribed to pattern "course:*:comments"');
    return { publisher, subscriber };
  } catch (error) {
    console.error('[Redis] Initialization error:', error.message);
    throw error;
  }
}

/**
 * Publish a comment payload to the course Redis channel
 * Channel name: course:{courseId}:comments
 */
async function publishComment(courseId, commentPayload) {
  if (!publisher || !publisher.isOpen) {
    throw new Error('Redis publisher is not connected');
  }

  const channel = `course:${courseId}:comments`;
  const message = JSON.stringify(commentPayload);
  await publisher.publish(channel, message);
}

/**
 * Close Redis clients
 */
async function closePubSub() {
  if (subscriber && subscriber.isOpen) {
    await subscriber.quit();
  }
  if (publisher && publisher.isOpen) {
    await publisher.quit();
  }
  publisher = null;
  subscriber = null;
}

module.exports = {
  initPubSub,
  publishComment,
  closePubSub
};
