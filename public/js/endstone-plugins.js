// Fetch and display Endstone plugins from GitHub.
(() => {
  const ORG = 'EuphoriaDevelopmentOrg';
  const CACHE_KEY = 'endstonePluginsCache:v1';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const RELEASE_CACHE_KEY = 'endstoneReleaseDownloadsCache:v1';
  const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  function isEndstoneRepo(repo) {
    if (!repo) return false;
    if (repo.archived) return false;
    if (repo.fork) return false;
    return /-endstone$/i.test(repo.name || '');
  }

  function normalizeName(name) {
    return (name || '').replace(/-Endstone$/i, '');
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
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.ts || !Array.isArray(parsed.items)) return null;
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed.items;
    } catch {
      return null;
    }
  }

  function saveCache(items) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ts: Date.now(), items }),
      );
    } catch {
      // ignore storage failures (private mode, disabled storage, etc.)
    }
  }

  function setCount(count) {
    const n = Number(count) || 0;
    const el = document.getElementById('endstone-plugin-count');
    if (el) el.textContent = String(n);

    // Allow other scripts (e.g. stats) to react without duplicating GitHub requests.
    try {
      window.dispatchEvent(new CustomEvent('endstone-plugins:count', { detail: { count: n } }));
    } catch {
      // ignore
    }
  }

  function loadReleaseCache() {
    try {
      const raw = localStorage.getItem(RELEASE_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function saveReleaseCache(cache) {
    try {
      localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore storage failures (private mode, disabled storage, etc.)
    }
  }

  const releaseCache = loadReleaseCache();
  const releaseInFlight = new Map();
  let releasesRateLimitedUntil = 0;

  function getCachedRelease(repoName) {
    const entry = releaseCache && repoName ? releaseCache[repoName] : null;
    if (!entry || typeof entry !== 'object') return null;
    if (!entry.ts) return null;
    if (Date.now() - entry.ts > RELEASE_CACHE_TTL_MS) return null;
    return entry;
  }

  function setCachedRelease(repoName, data) {
    if (!repoName) return;
    releaseCache[repoName] = { ts: Date.now(), ...(data || {}) };
    saveReleaseCache(releaseCache);
  }

  function pickBestAsset(assets) {
    const list = Array.isArray(assets) ? assets : [];
    const jar = list.find(
      (a) =>
        a &&
        typeof a.name === 'string' &&
        a.browser_download_url &&
        String(a.name).toLowerCase().endsWith('.jar'),
    );
    if (jar) return jar;

    const zip = list.find(
      (a) =>
        a &&
        typeof a.name === 'string' &&
        a.browser_download_url &&
        String(a.name).toLowerCase().endsWith('.zip'),
    );
    if (zip) return zip;

    return list.find((a) => a && a.browser_download_url) || null;
  }

  function setDownloadButtonDisabled(btn, label, title) {
    if (!btn) return;
    btn.textContent = label || 'Download';
    btn.removeAttribute('href');
    btn.removeAttribute('target');
    btn.removeAttribute('rel');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('tabindex', '-1');
    if (title) btn.title = title;

    btn.className =
      'inline-flex items-center justify-center px-3 py-2 rounded-lg bg-neutral-800 text-neutral-400 text-sm font-semibold border border-neutral-700 opacity-70 cursor-not-allowed';
  }

  function setDownloadButtonEnabled(btn, href, title) {
    if (!btn) return;
    btn.textContent = 'Download';
    btn.href = href;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.removeAttribute('tabindex');
    btn.setAttribute('aria-disabled', 'false');
    if (title) btn.title = title;

    btn.className =
      'inline-flex items-center justify-center px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors';
  }

  function applyDownloadState(grid, repoName, state) {
    if (!grid || !repoName) return;
    const buttons = Array.from(grid.querySelectorAll('a[data-download-repo]')).filter(
      (btn) => btn && btn.dataset && btn.dataset.downloadRepo === repoName,
    );
    buttons.forEach((btn) => {
      if (!state || typeof state !== 'object') {
        setDownloadButtonDisabled(btn, 'Download', 'Fetching latest GitHub release...');
        return;
      }

      if (state.kind === 'asset' && state.url) {
        const title = state.assetName ? `Download ${state.assetName}` : 'Download from GitHub Releases';
        setDownloadButtonEnabled(btn, state.url, title);
        return;
      }

      if (state.kind === 'no_release') {
        setDownloadButtonDisabled(btn, 'No Release', 'No GitHub releases found for this plugin.');
        return;
      }

      if (state.kind === 'no_asset') {
        setDownloadButtonDisabled(btn, 'No Download', 'No downloadable release assets found.');
        return;
      }

      if (state.kind === 'rate_limited') {
        setDownloadButtonDisabled(btn, 'Rate Limited', 'GitHub rate limit exceeded. Please try again later.');
        return;
      }

      setDownloadButtonDisabled(btn, 'Unavailable', 'Unable to load release downloads right now.');
    });
  }

  async function fetchLatestReleaseDownload(repoName) {
    const now = Date.now();
    if (releasesRateLimitedUntil && now < releasesRateLimitedUntil) {
      return { kind: 'rate_limited' };
    }

    async function fetchJson(url) {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });

      if (!res.ok) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        if (res.status === 403 && remaining === '0') {
          const resetSeconds = reset ? Number(reset) : 0;
          if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
            releasesRateLimitedUntil = resetSeconds * 1000;
          }
          return { ok: false, status: res.status, rateLimited: true, json: null };
        }

        return { ok: false, status: res.status, rateLimited: false, json: null };
      }

      try {
        return { ok: true, status: res.status, rateLimited: false, json: await res.json() };
      } catch {
        return { ok: false, status: res.status, rateLimited: false, json: null };
      }
    }

    const repoPath = `${ORG}/${encodeURIComponent(repoName)}`;

    // Prefer stable "latest" release (excludes pre-releases).
    const latest = await fetchJson(`https://api.github.com/repos/${repoPath}/releases/latest`);
    if (latest.ok) {
      const best = pickBestAsset(latest.json && latest.json.assets);
      if (best && best.browser_download_url) {
        return { kind: 'asset', url: best.browser_download_url, assetName: best.name || '' };
      }
      return { kind: 'no_asset' };
    }
    if (latest.rateLimited) return { kind: 'rate_limited' };

    // Fallback: handle repos that only publish pre-releases (where /latest returns 404).
    if (latest.status === 404) {
      const list = await fetchJson(`https://api.github.com/repos/${repoPath}/releases?per_page=10`);
      if (list.rateLimited) return { kind: 'rate_limited' };
      if (!list.ok) return { kind: 'no_release' };

      const releases = Array.isArray(list.json) ? list.json : [];
      const firstPublished = releases.find((r) => r && !r.draft);
      if (!firstPublished) return { kind: 'no_release' };

      const best = pickBestAsset(firstPublished.assets);
      if (best && best.browser_download_url) {
        return { kind: 'asset', url: best.browser_download_url, assetName: best.name || '' };
      }
      return { kind: 'no_asset' };
    }

    return { kind: 'error' };
  }

  function hydrateDownloadButtons(grid, items) {
    if (!grid) return;
    const repos = Array.isArray(items) ? items : [];

    repos.forEach((repo) => {
      const repoName = repo && repo.name ? String(repo.name) : '';
      if (!repoName) return;

      // Apply cached state immediately (if available), otherwise show loading/disabled.
      const cached = getCachedRelease(repoName);
      if (cached) applyDownloadState(grid, repoName, cached);
      else applyDownloadState(grid, repoName, null);

      // Reuse in-flight fetches across cached->fresh re-renders.
      if (releaseInFlight.has(repoName)) return;

      // If cached, don't fetch again.
      if (cached) return;

      const p = fetchLatestReleaseDownload(repoName)
        .then((state) => {
          const normalized = state && typeof state === 'object' ? state : { kind: 'error' };
          setCachedRelease(repoName, normalized);
          applyDownloadState(grid, repoName, normalized);
        })
        .catch(() => {
          const normalized = { kind: 'error' };
          setCachedRelease(repoName, normalized);
          applyDownloadState(grid, repoName, normalized);
        })
        .finally(() => {
          releaseInFlight.delete(repoName);
        });

      releaseInFlight.set(repoName, p);
    });
  }

  function getGridColumnCount(grid) {
    if (!grid) return 1;
    const computed = window.getComputedStyle(grid);
    const template = computed && computed.gridTemplateColumns ? String(computed.gridTemplateColumns) : '';
    if (!template || template === 'none') return 1;

    // Some browsers may still return repeat(...) here; handle it defensively.
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

    // If the grid doesn't need toggling, ensure everything is visible and hide/remove any existing toggle.
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

    if (!('moreExpanded' in grid.dataset)) grid.dataset.moreExpanded = '0'; // default collapsed

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
        // Only recompute the clamp while collapsed.
        if (grid.dataset.moreExpanded === '1') return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      });
    }

    update();
  }

  function render(items) {
    const grid = document.getElementById('endstone-plugins-grid');
    if (!grid) return;

    grid.innerHTML = '';
    setCount(items.length);

    items.forEach((repo) => {
      const card = document.createElement('article');
      card.className =
        'glass rounded-lg p-4 sm:p-6 shadow border border-neutral-800 card-hover text-left';

      const name = normalizeName(repo.name);
      const description = repo.description || 'No description provided.';
      const stars = Number(repo.stargazers_count || 0).toLocaleString();
      const forks = Number(repo.forks_count || 0).toLocaleString();
      const language = repo.language || 'Unknown';
      const updated = formatDate(repo.updated_at);

      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-lg sm:text-xl font-semibold text-neutral-100 truncate">${name}</h3>
            <p class="text-neutral-400 text-sm mt-1 line-clamp-2">${description}</p>
          </div>
          <span class="shrink-0 text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
            Endstone
          </span>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">${language}</span>
          <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">★ ${stars}</span>
          <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">⑂ ${forks}</span>
          <span class="ml-auto text-neutral-500">Updated ${updated}</span>
        </div>
 
        <div class="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <a data-download-repo="${repo.name}"
             class="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-neutral-800 text-neutral-400 text-sm font-semibold border border-neutral-700 opacity-70 cursor-not-allowed"
             aria-disabled="true" tabindex="-1" title="Fetching latest GitHub release...">
            Download
          </a>
          <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
            View on GitHub
          </a>
          <a href="${repo.html_url}/releases" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold transition-colors border border-neutral-700">
            Releases
          </a>
        </div>
      `;
 
      grid.appendChild(card);
    });

    hydrateDownloadButtons(grid, items);
    ensureMoreToggle(grid);
  }

  function renderError(message) {
    const grid = document.getElementById('endstone-plugins-grid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="col-span-full text-center text-neutral-400">
        <p>${message}</p>
      </div>
    `;
    setCount(0);

    ensureMoreToggle(grid);
  }

  async function fetchPlugins() {
    const url = `https://api.github.com/orgs/${ORG}/repos?per_page=100&sort=updated`;
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

    const repos = await res.json();
    const plugins = Array.isArray(repos) ? repos.filter(isEndstoneRepo) : [];

    // Keep only the fields we render/cache.
    return plugins.map((repo) => ({
      name: repo.name,
      html_url: repo.html_url,
      description: repo.description,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      language: repo.language,
      updated_at: repo.updated_at,
      archived: repo.archived,
      fork: repo.fork,
    }));
  }

  async function loadEndstonePlugins() {
    const grid = document.getElementById('endstone-plugins-grid');
    if (!grid) return;

    // Render cached content immediately (if available), then refresh in background.
    const cached = loadCache();
    if (cached && cached.length) render(cached);

    try {
      const items = await fetchPlugins();
      if (!items.length) {
        renderError('No Endstone plugins found yet.');
        return;
      }

      saveCache(items);
      render(items);
    } catch (err) {
      // If cache rendered, avoid replacing it with an error.
      if (cached && cached.length) return;
      renderError(err instanceof Error ? err.message : 'Unable to load plugins at this time.');
    }
  }

  document.addEventListener('DOMContentLoaded', loadEndstonePlugins);
})();
