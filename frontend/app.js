// Global state
let currentCourseId = 'course-101';
let currentUserId = 'user_tarun';
let wsClient = null;
const renderedCommentIds = new Set();

// DOM Elements
const commentList = document.getElementById('comment-list');
const commentInput = document.getElementById('comment-input');
const commentSubmit = document.getElementById('comment-submit');
const commentForm = document.getElementById('comment-form');
const courseSelect = document.getElementById('course-select');
const customCourseInput = document.getElementById('custom-course-input');
const currentCourseTitle = document.getElementById('current-course-title');
const commentCountBadge = document.getElementById('comment-count-badge');
const emptyState = document.getElementById('empty-state');
const wsStatus = document.getElementById('ws-status');
const wsStatusText = document.getElementById('ws-status-text');
const userIdInput = document.getElementById('user-id-input');
const userAvatar = document.getElementById('user-avatar');
const charCount = document.getElementById('char-count');
const refreshBtn = document.getElementById('refresh-btn');
const latencyMetric = document.getElementById('latency-metric');

/**
 * Generate deterministically pleasing gradient colors from string
 */
function getAvatarGradient(str) {
  const gradients = [
    'linear-gradient(135deg, #6366f1, #06b6d4)',
    'linear-gradient(135deg, #ec4899, #8b5cf6)',
    'linear-gradient(135deg, #10b981, #3b82f6)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #8b5cf6, #ec4899)',
    'linear-gradient(135deg, #06b6d4, #10b981)'
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

/**
 * Format timestamp into relative or readable time
 */
function formatTime(isoString) {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSeconds = Math.floor((now - date) / 1000);

    if (diffSeconds < 5) return 'Just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return 'Recently';
  }
}

/**
 * Render a single comment into the feed
 * REQUIRED ATTRIBUTE: data-testid="comment-item-{id}"
 */
function renderComment(comment, isNew = false) {
  if (!comment || !comment.id) return;

  // Deduplication check
  if (renderedCommentIds.has(comment.id)) {
    return;
  }
  renderedCommentIds.add(comment.id);

  // Hide empty state
  emptyState.classList.add('hidden');

  const item = document.createElement('div');
  item.className = `comment-item ${isNew ? 'new-arrival' : ''}`;
  item.setAttribute('data-testid', `comment-item-${comment.id}`);

  const userInitial = (comment.userId || 'U').substring(0, 2).toUpperCase();
  const avatarBg = getAvatarGradient(comment.userId || 'U');
  const isSelf = comment.userId === currentUserId;

  item.innerHTML = `
    <div class="item-avatar" style="background: ${avatarBg};">
      ${escapeHtml(userInitial)}
    </div>
    <div class="item-content">
      <div class="item-meta">
        <span class="item-user">${escapeHtml(comment.userId || 'Anonymous')}</span>
        ${isSelf ? '<span class="item-badge">You</span>' : ''}
        <span class="item-time" title="${escapeHtml(comment.createdAt || '')}">${formatTime(comment.createdAt)}</span>
      </div>
      <div class="item-text">${escapeHtml(comment.text || '')}</div>
    </div>
  `;

  commentList.appendChild(item);
  updateCommentCount();

  // Scroll to latest comment
  const scrollContainer = commentList.parentElement;
  scrollContainer.scrollTop = scrollContainer.scrollHeight;

  // Remove animation highlight after 2 seconds
  if (isNew) {
    setTimeout(() => {
      item.classList.remove('new-arrival');
    }, 2000);
  }
}

/**
 * HTML Escape helper
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Update total comment count badge
 */
function updateCommentCount() {
  const count = renderedCommentIds.size;
  commentCountBadge.textContent = `${count} comment${count === 1 ? '' : 's'}`;
}

/**
 * Fetch historical comments for current course (GET /api/courses/:courseId/comments)
 */
async function loadHistoricalComments() {
  // Clear existing rendered comments
  renderedCommentIds.clear();
  commentList.innerHTML = `
    <div id="feed-loading" class="feed-loading">
      <div class="spinner"></div>
      <p>Loading course conversation...</p>
    </div>
  `;
  emptyState.classList.add('hidden');

  try {
    const startTime = performance.now();
    const response = await fetch(`/api/courses/${encodeURIComponent(currentCourseId)}/comments`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const comments = await response.json();
    const duration = Math.round(performance.now() - startTime);
    if (latencyMetric) {
      latencyMetric.textContent = `${duration}ms`;
    }

    commentList.innerHTML = '';

    if (Array.isArray(comments) && comments.length > 0) {
      comments.forEach((c) => renderComment(c, false));
    } else {
      emptyState.classList.remove('hidden');
    }
    updateCommentCount();
  } catch (error) {
    console.error('Failed to load comments:', error);
    commentList.innerHTML = `
      <div class="feed-loading">
        <p style="color: var(--accent-rose);">Failed to load comments (${escapeHtml(error.message)})</p>
      </div>
    `;
  }
}

/**
 * Initialize WebSocket connection for the current course
 */
function setupCourseWebSocket() {
  if (wsClient) {
    wsClient.close();
  }

  wsClient = new CourseWebSocketClient(currentCourseId, {
    onStatusChange: (status, message) => {
      wsStatus.className = `status-badge ${status}`;
      wsStatusText.textContent = message;
    },
    onMessage: (newComment) => {
      console.log('[WS Broadcast Received]:', newComment);
      renderComment(newComment, true);
    }
  });
}

/**
 * Post a new comment (POST /api/courses/:courseId/comments)
 */
async function submitComment() {
  const text = commentInput.value.trim();
  const userId = userIdInput.value.trim() || 'user_anonymous';

  if (!text) {
    commentInput.focus();
    return;
  }

  // Disable button while posting
  commentSubmit.disabled = true;
  const originalText = commentSubmit.querySelector('.btn-text').textContent;
  commentSubmit.querySelector('.btn-text').textContent = 'Posting...';

  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(currentCourseId)}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId,
        text
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const createdComment = await response.json();
    
    // Render immediately if WebSocket hasn't already rendered it
    renderComment(createdComment, true);

    // Reset input field
    commentInput.value = '';
    charCount.textContent = '0';
    commentInput.focus();
  } catch (error) {
    console.error('Failed to post comment:', error);
    alert(`Could not post comment: ${error.message}`);
  } finally {
    commentSubmit.disabled = false;
    commentSubmit.querySelector('.btn-text').textContent = originalText;
  }
}

/**
 * Switch course
 */
function switchCourse(newCourseId, newTitle = null) {
  if (!newCourseId || newCourseId === currentCourseId) return;

  currentCourseId = newCourseId;

  if (newTitle) {
    currentCourseTitle.textContent = newTitle;
  } else {
    currentCourseTitle.textContent = `Course: ${newCourseId}`;
  }

  // Update URL without full reload
  const url = new URL(window.location);
  url.searchParams.set('courseId', currentCourseId);
  window.history.replaceState({}, '', url);

  // Reload history and reconnect WebSocket to new course room
  loadHistoricalComments();
  setupCourseWebSocket();
}

/**
 * Parse courseId from URL if present
 */
function initCourseFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const courseParam = params.get('courseId');
  if (courseParam) {
    currentCourseId = courseParam;
    if (courseSelect) {
      let matched = false;
      for (const opt of courseSelect.options) {
        if (opt.value === courseParam) {
          courseSelect.value = courseParam;
          matched = true;
          break;
        }
      }
      if (!matched) {
        courseSelect.value = 'custom';
        customCourseInput.value = courseParam;
        customCourseInput.classList.remove('hidden');
      }
    }
  }
}

// Event Listeners
commentSubmit.addEventListener('click', (e) => {
  e.preventDefault();
  submitComment();
});

commentForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitComment();
});

commentInput.addEventListener('keydown', (e) => {
  // Submit on Enter (without Shift)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitComment();
  }
});

commentInput.addEventListener('input', () => {
  charCount.textContent = commentInput.value.length;
});

courseSelect.addEventListener('change', (e) => {
  const selected = e.target.value;
  if (selected === 'custom') {
    customCourseInput.classList.remove('hidden');
    customCourseInput.focus();
  } else {
    customCourseInput.classList.add('hidden');
    const title = e.target.options[e.target.selectedIndex].text;
    switchCourse(selected, title);
  }
});

customCourseInput.addEventListener('change', (e) => {
  const val = e.target.value.trim();
  if (val) {
    switchCourse(val, `Course: ${val}`);
  }
});

userIdInput.addEventListener('input', (e) => {
  currentUserId = e.target.value.trim() || 'user_anonymous';
  const initial = currentUserId.substring(0, 2).toUpperCase();
  userAvatar.textContent = initial;
  userAvatar.style.background = getAvatarGradient(currentUserId);
});

refreshBtn.addEventListener('click', () => {
  loadHistoricalComments();
});

// App Initialization
window.addEventListener('DOMContentLoaded', () => {
  initCourseFromUrl();
  currentUserId = userIdInput.value.trim();
  userAvatar.textContent = currentUserId.substring(0, 2).toUpperCase();
  userAvatar.style.background = getAvatarGradient(currentUserId);

  // Load history and connect WebSocket
  loadHistoricalComments();
  setupCourseWebSocket();
});
