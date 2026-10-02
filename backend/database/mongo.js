const { MongoClient, ObjectId } = require('mongodb');

let client = null;
let db = null;
let commentsCollection = null;

const DEFAULT_URI = 'mongodb://localhost:27017/course_comments_db';

/**
 * Connect to MongoDB and ensure required indexes
 */
async function connectDB(uri = process.env.MONGO_URI || DEFAULT_URI) {
  if (db && commentsCollection) {
    return { client, db, commentsCollection };
  }

  try {
    client = new MongoClient(uri);
    await client.connect();

    // Extract database name from URI or fallback to course_comments_db
    const parsedUri = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    const dbName = parsedUri.pathname.replace(/^\//, '') || 'course_comments_db';

    db = client.db(dbName);
    commentsCollection = db.collection('comments');

    // Create required compound index: { courseId: 1, createdAt: -1 }
    await commentsCollection.createIndex({ courseId: 1, createdAt: -1 });
    console.log(`[MongoDB] Connected successfully to "${dbName}". Index on { courseId: 1, createdAt: -1 } verified.`);

    return { client, db, commentsCollection };
  } catch (error) {
    console.error('[MongoDB] Connection error:', error.message);
    throw error;
  }
}

/**
 * Returns the comments collection
 */
function getCommentsCollection() {
  if (!commentsCollection) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return commentsCollection;
}

/**
 * Insert a comment document into MongoDB
 */
async function insertComment({ courseId, userId, text, createdAt }) {
  const collection = getCommentsCollection();
  const timestamp = createdAt || new Date().toISOString();

  const doc = {
    courseId: String(courseId),
    userId: String(userId),
    text: String(text),
    createdAt: timestamp
  };

  const result = await collection.insertOne(doc);

  return {
    id: result.insertedId.toString(),
    courseId: doc.courseId,
    userId: doc.userId,
    text: doc.text,
    createdAt: doc.createdAt
  };
}

/**
 * Retrieve the 50 most recent historical comments for a course,
 * sorted chronologically (oldest to newest).
 */
async function getHistoricalComments(courseId, limit = 50) {
  const collection = getCommentsCollection();

  // Fetch the latest 50 documents using the compound index
  const docs = await collection
    .find({ courseId: String(courseId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  // Reverse to chronological order (oldest first)
  const chronological = docs.reverse();

  return chronological.map((doc) => ({
    id: (doc._id ? doc._id.toString() : doc.id) || '',
    courseId: doc.courseId,
    userId: doc.userId,
    text: doc.text,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : new Date(doc.createdAt).toISOString()
  }));
}

/**
 * Close MongoDB client
 */
async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    commentsCollection = null;
  }
}

module.exports = {
  connectDB,
  getCommentsCollection,
  insertComment,
  getHistoricalComments,
  closeDB
};
