const express = require('express');
const router = express.Router({ mergeParams: true });
const { insertComment, getHistoricalComments } = require('../database/mongo');
const { publishComment } = require('../pubsub/redis');

/**
 * POST /api/courses/:courseId/comments
 * Creates a new comment, stores it in MongoDB, publishes to Redis, and returns 201 Created
 */
router.post('/:courseId/comments', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, text } = req.body;

    // Validate request payload
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId is required and must be a non-empty string' });
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required and must be a non-empty string' });
    }

    // 1. Insert comment into MongoDB
    const comment = await insertComment({
      courseId,
      userId: userId.trim(),
      text: text.trim(),
      createdAt: new Date().toISOString()
    });

    // 2. Publish to Redis channel: course:{courseId}:comments
    try {
      await publishComment(courseId, comment);
    } catch (pubErr) {
      console.error('[Redis Publish Error]:', pubErr.message);
      // We log but don't fail the HTTP response if Mongo succeeded
    }

    // 3. Return 201 Created with comment matching schema
    return res.status(201).json(comment);
  } catch (error) {
    console.error('[POST Comment Error]:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/courses/:courseId/comments
 * Returns the most recent 50 comments, sorted oldest to newest (chronological)
 */
router.get('/:courseId/comments', async (req, res) => {
  try {
    const { courseId } = req.params;
    const comments = await getHistoricalComments(courseId, 50);

    return res.status(200).json(comments);
  } catch (error) {
    console.error('[GET Comments Error]:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
