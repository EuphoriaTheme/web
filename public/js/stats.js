// Fetch and display real-time statistics from Euphoria Development API
(() => {
  const STATS_URL = 'https://api.euphoriadevelopment.uk/stats/';
  const ENDSTONE_CACHE_KEY = 'endstonePluginsCache:v1';
  const ENDSTONE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const BLUEPRINT_CACHE_KEY = 'blueprintProductsCache:v2';
  const BLUEPRINT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  const timers = new Map();

  const state = {
    blueprintCount: null,
    appsCount: null,
    endstoneCount: null,
  };

  function safeInt(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.floor(n));
  }

  function getAppsCount() {
    return document.querySelectorAll('#apps article').length;
  }

  function loadCacheCount(key, ttlMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.ts || !Array.isArray(parsed.items)) return null;
      if (Date.now() - parsed.ts > ttlMs) return null;
      return parsed.items.length;
    } catch {
      return null;
    }
  }

  // Animate counter from the current displayed value to the target value
  function animateCounter(elementId, targetValue, options = {}) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const duration = safeInt(options.durationMs, 1200);
    const target = safeInt(targetValue, 0);

    const currentText = String(element.textContent || '').replace(/[^\d]/g, '');
    const start = safeInt(currentText, 0);

    if (timers.has(elementId)) {
      clearInterval(timers.get(elementId));
      timers.delete(elementId);
    }

    if (start === target) {
      element.textContent = target.toLocaleString();
      return;
    }

    const steps = Math.max(1, Math.floor(duration / 16));
    const delta = target - start;
    let i = 0;

    const timer = setInterval(() => {
      i += 1;
      const p = Math.min(1, i / steps);
      const next = Math.round(start + delta * p);
      element.textContent = next.toLocaleString();

      if (p >= 1) {
        clearInterval(timer);
        timers.delete(elementId);
      }
    }, 16);

    timers.set(elementId, timer);
  }

  function updateTotalProjects() {
    if (state.blueprintCount === null) return;

    const blueprint = safeInt(state.blueprintCount, 0);
    const apps = safeInt(state.appsCount, 0);
    const endstone = safeInt(state.endstoneCount, 0);

    const totalProjects = blueprint + apps + endstone;
    animateCounter('total-projects', totalProjects, { durationMs: 900 });
  }

  async function loadStats() {
    state.appsCount = getAppsCount();

    // Prefer cached Endstone plugin count if available (avoids waiting for GitHub fetch).
    const cachedEndstone = loadCacheCount(ENDSTONE_CACHE_KEY, ENDSTONE_CACHE_TTL_MS);
    if (cachedEndstone !== null) state.endstoneCount = cachedEndstone;

    try {
      const response = await fetch(STATS_URL, { headers: { Accept: 'application/json' } });
      const data = await response.json();

      // Count Blueprint addons + themes (the API returns both in blueprintExtensions).
      const blueprintExtensions = Array.isArray(data && data.blueprintExtensions) ? data.blueprintExtensions : [];
      state.blueprintCount = blueprintExtensions.length;

      animateCounter('api-calls', safeInt(data && data.totalApiCalls, 0), { durationMs: 1500 });
      animateCounter('active-panels', safeInt(data && data.totalInstalls, 0), { durationMs: 1500 });
      updateTotalProjects();
    } catch (error) {
      console.error('Error fetching stats:', error);

      // Fall back to cached Blueprint product list (if available).
      const cachedBlueprint = loadCacheCount(BLUEPRINT_CACHE_KEY, BLUEPRINT_CACHE_TTL_MS);
      if (cachedBlueprint !== null) {
        state.blueprintCount = cachedBlueprint;
        updateTotalProjects();
      }

      // Otherwise, keep the static HTML values.
    }
  }

  // When Endstone plugins finish loading, update the total projects count.
  window.addEventListener('endstone-plugins:count', (e) => {
    const count = safeInt(e && e.detail ? e.detail.count : 0, 0);
    state.endstoneCount = count;
    updateTotalProjects();
  });

  // Load stats when page loads
  document.addEventListener('DOMContentLoaded', loadStats);
})();
