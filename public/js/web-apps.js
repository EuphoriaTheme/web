// Hydrate the Web Applications cards with GitHub repo metadata (stars, forks, language, last updated).
(() => {
  const CACHE_KEY = 'webAppsGithubRepoMetaCache:v1';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  function escapeHtml(input) {
    return String(input || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getGridColumnCount(grid) {
    if (!grid) return 1;
    const computed = window.getComputedStyle(grid);
    const template = computed && computed.gridTemplateColumns ? String(computed.gridTemplateColumns) : '';
    if (!template || template === 'none') return 1;

    const repeatMatch = template.match(/repeat\((\d+),/);
    if (repeatMatch) {
      const n = Number.parseInt(repeatMatch[1], 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }

    const cols = template.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }

  function ensureMoreToggle(grid, options = {}) {
    if (!grid || !grid.id) return;

    const rows = Number.isFinite(Number(options.rows)) ? Number(options.rows) : 1;
    const moreLabel = options.moreLabel ? String(options.moreLabel) : 'More';
    const lessLabel = options.lessLabel ? String(options.lessLabel) : 'Show less';

    const items = Array.from(grid.children).filter((el) => el && el.nodeType === 1);
    const columns = getGridColumnCount(grid);
    const visibleCount = Math.max(1, columns * Math.max(1, rows));
    const needsToggle = items.length > visibleCount;

    const wrapperId = `${grid.id}-more-toggle`;
    let wrapper = document.getElementById(wrapperId);

    if (!needsToggle) {
      items.forEach((el) => el.classList.remove('hidden'));
      if (wrapper) wrapper.classList.add('hidden');
      return;
    }

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = wrapperId;
      wrapper.className = 'mt-4 flex justify-center';
      wrapper.innerHTML = `
        <button
          type="button"
          class="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold transition-colors border border-neutral-700"
          aria-controls="${grid.id}"
        >${moreLabel}</button>
      `;
      grid.insertAdjacentElement('afterend', wrapper);
    }

    const button = wrapper.querySelector('button');
    if (!button) return;

    const update = () => {
      const freshItems = Array.from(grid.children).filter((el) => el && el.nodeType === 1);
      const colsNow = getGridColumnCount(grid);
      const visibleNow = Math.max(1, colsNow * Math.max(1, rows));
      const expanded = grid.dataset.moreExpanded === '1';

      if (freshItems.length <= visibleNow) {
        freshItems.forEach((el) => el.classList.remove('hidden'));
        wrapper.classList.add('hidden');
        return;
      }

      wrapper.classList.remove('hidden');

      if (expanded) {
        freshItems.forEach((el) => el.classList.remove('hidden'));
        button.textContent = lessLabel;
        button.setAttribute('aria-expanded', 'true');
        return;
      }

      freshItems.forEach((el, idx) => {
        if (idx < visibleNow) el.classList.remove('hidden');
        else el.classList.add('hidden');
      });
      button.textContent = moreLabel;
      button.setAttribute('aria-expanded', 'false');
    };

    if (!('moreExpanded' in grid.dataset)) grid.dataset.moreExpanded = '0';

    if (!button.dataset.moreBound) {
      button.dataset.moreBound = '1';
      button.addEventListener('click', () => {
        grid.dataset.moreExpanded = grid.dataset.moreExpanded === '1' ? '0' : '1';
        update();
      });
    }

    if (!grid.dataset.moreResizeBound) {
      grid.dataset.moreResizeBound = '1';
      let raf = 0;
      window.addEventListener('resize', () => {
        if (grid.dataset.moreExpanded === '1') return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      });
    }

    update();
  }

  function formatDate(isoString) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(new Date(isoString));
    } catch {
      return isoString || '';
    }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore storage failures (private mode, disabled storage, etc.)
    }
  }

  const cache = loadCache();
  const inFlight = new Map();

  function getCached(repoPath) {
    const entry = cache && repoPath ? cache[repoPath] : null;
    if (!entry || typeof entry !== 'object') return null;
    if (!entry.ts) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry;
  }

  function setCached(repoPath, data) {
    if (!repoPath) return;
    cache[repoPath] = { ts: Date.now(), ...(data || {}) };
    saveCache(cache);
  }

  function setMetaHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle('hidden', Boolean(hidden));
  }

  function renderMeta(el, meta) {
    if (!el || !meta) return;

    const language = meta.language || 'Unknown';
    const stars = Number(meta.stars || 0).toLocaleString();
    const forks = Number(meta.forks || 0).toLocaleString();
    const updated = meta.updated_at ? formatDate(meta.updated_at) : null;

    el.innerHTML = `
      <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">${escapeHtml(language)}</span>
      <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">${escapeHtml(stars)} stars</span>
      <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">${escapeHtml(forks)} forks</span>
      ${
        updated
          ? `<span class="ml-auto text-neutral-500">Updated ${escapeHtml(updated)}</span>`
          : ''
      }
    `;

    setMetaHidden(el, false);
  }

  async function fetchRepoMeta(repoPath) {
    if (!repoPath) throw new Error('Missing repo path');
    if (inFlight.has(repoPath)) return inFlight.get(repoPath);

    const p = (async () => {
      const url = `https://api.github.com/repos/${repoPath}`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });

      if (!res.ok) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (res.status === 403 && remaining === '0') {
          throw new Error('GitHub rate limit exceeded. Please try again later.');
        }
        throw new Error(`GitHub request failed (${res.status}).`);
      }

      const repo = await res.json();
      return {
        language: repo && repo.language ? String(repo.language) : 'Unknown',
        stars: typeof (repo && repo.stargazers_count) === 'number' ? repo.stargazers_count : 0,
        forks: typeof (repo && repo.forks_count) === 'number' ? repo.forks_count : 0,
        updated_at: repo && repo.updated_at ? String(repo.updated_at) : null,
      };
    })();

    inFlight.set(repoPath, p);
    try {
      const data = await p;
      inFlight.delete(repoPath);
      return data;
    } catch (err) {
      inFlight.delete(repoPath);
      throw err;
    }
  }

  async function hydrateWebApps() {
    const els = Array.from(document.querySelectorAll('[data-github-meta][data-github-repo]'));
    if (!els.length) return;

    const byRepo = new Map();
    els.forEach((el) => {
      const repoPath = String(el.getAttribute('data-github-repo') || '').trim();
      if (!repoPath) return;
      if (!byRepo.has(repoPath)) byRepo.set(repoPath, []);
      byRepo.get(repoPath).push(el);
    });

    byRepo.forEach((list, repoPath) => {
      const cached = getCached(repoPath);
      if (cached) renderMeta(list[0], cached); // render once then clone into others below
      for (let i = 1; i < list.length; i += 1) {
        if (cached) renderMeta(list[i], cached);
      }
    });

    const fetches = [];
    byRepo.forEach((list, repoPath) => {
      if (getCached(repoPath)) return;
      fetches.push(
        fetchRepoMeta(repoPath)
          .then((meta) => {
            setCached(repoPath, meta);
            list.forEach((el) => renderMeta(el, meta));
          })
          .catch(() => {
            // Keep the meta hidden on failures.
            list.forEach((el) => setMetaHidden(el, true));
          }),
      );
    });

    if (fetches.length) await Promise.allSettled(fetches);
  }

  function initWebAppsToggle() {
    const grid = document.getElementById('web-apps-grid');
    if (grid) {
      ensureMoreToggle(grid);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    hydrateWebApps();
    initWebAppsToggle();
  });
})();

