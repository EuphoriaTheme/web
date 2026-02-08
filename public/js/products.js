// Fetch and display Blueprint addons and themes from Euphoria Development API.
(() => {
  const STATS_URL = 'https://api.euphoriadevelopment.uk/stats/';
  const CACHE_KEY = 'blueprintProductsCache:v2';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  const PLATFORM_PRIORITY = ['BUILTBYBIT', 'SOURCEXCHANGE'];

  function normalizeType(type) {
    return String(type || '').trim().toLowerCase();
  }

  function safeUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(String(url), window.location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function escapeHtml(input) {
    return String(input || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(input) {
    // Keep it simple; we only use this for attributes like src/href/alt.
    return escapeHtml(input);
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
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
    } catch {
      // ignore storage failures (private mode, disabled storage, etc.)
    }
  }

  function setCount(id, count) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(count);
  }

  function getBannerUrl(product) {
    const banner = product && product.banner;
    if (!banner) return null;
    if (typeof banner === 'string') return banner;
    if (typeof banner === 'object') return banner.lowres || banner.fullres || null;
    return null;
  }

  function getBlueprintUrl(product) {
    const identifier = product && product.identifier;
    if (!identifier) return null;
    return `https://blueprint.zip/extensions/${encodeURIComponent(identifier)}`;
  }

  function getOffer(platforms, platformKey) {
    if (!platforms || typeof platforms !== 'object') return null;
    const raw = platforms[platformKey];
    if (!raw || typeof raw !== 'object') return null;

    const price = Number(raw.price);
    const currency = raw.currency ? String(raw.currency).toUpperCase() : '';
    const url = safeUrl(raw.url);

    return {
      platform: platformKey,
      price: Number.isFinite(price) ? price : 0,
      currency,
      url,
    };
  }

  function isFree(platforms) {
    if (!platforms || typeof platforms !== 'object') return true;

    for (const key of Object.keys(platforms)) {
      const offer = getOffer(platforms, key);
      if (offer && offer.price > 0) return false;
    }

    return true;
  }

  function getAnyPaidOffer(platforms) {
    if (!platforms || typeof platforms !== 'object') return null;

    // Prefer known platforms first, then anything else.
    for (const key of PLATFORM_PRIORITY) {
      const offer = getOffer(platforms, key);
      if (offer && offer.price > 0) return offer;
    }

    for (const key of Object.keys(platforms)) {
      const offer = getOffer(platforms, key);
      if (offer && offer.price > 0) return offer;
    }

    return null;
  }

  function formatPriceLabel(product) {
    const platforms = product && product.platforms;
    if (isFree(platforms)) return { label: 'FREE', sort: 0 };

    const offer = getAnyPaidOffer(platforms);
    if (!offer) return { label: 'PAID', sort: 1 };

    const amount = offer.price;
    const currency = offer.currency;

    if (currency) {
      try {
        return {
          label: new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount),
          sort: amount,
        };
      } catch {
        // Fall back to a simple label if Intl rejects the currency code.
      }
    }

    return {
      label: amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      sort: amount,
    };
  }

  function getLatestVersion(product) {
    const versions = product && product.versions;
    if (!Array.isArray(versions) || !versions.length) return null;

    // API appears to be newest-first; still guard by picking max created date.
    let best = null;
    let bestTs = -Infinity;
    for (const v of versions) {
      const ts = Date.parse(v && v.created ? v.created : '');
      if (!Number.isFinite(ts)) continue;
      if (ts > bestTs) {
        bestTs = ts;
        best = v;
      }
    }

    return best || versions[0];
  }

  function sortProducts(items) {
    return [...items].sort((a, b) => {
      const aFree = isFree(a && a.platforms);
      const bFree = isFree(b && b.platforms);
      if (aFree !== bFree) return aFree ? 1 : -1; // paid first

      const aPrice = formatPriceLabel(a).sort;
      const bPrice = formatPriceLabel(b).sort;
      if (bPrice !== aPrice) return bPrice - aPrice;

      const aPanels = Number(a && a.stats && a.stats.panels) || 0;
      const bPanels = Number(b && b.stats && b.stats.panels) || 0;
      if (bPanels !== aPanels) return bPanels - aPanels;

      return String(a && a.name ? a.name : '').localeCompare(String(b && b.name ? b.name : ''), undefined, {
        sensitivity: 'base',
      });
    });
  }

  function createCard(product) {
    const card = document.createElement('article');
    card.className = 'glass rounded-lg p-4 sm:p-6 shadow border border-neutral-800 card-hover text-left';

    const type = normalizeType(product && product.type);
    const isTheme = type === 'theme';
    const typeLabel = isTheme ? 'Theme' : 'Addon';
    const typeBadgeClass = isTheme
      ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/20'
      : 'bg-amber-500/15 text-amber-300 border border-amber-500/20';

    const name = String((product && product.name) || 'Untitled');
    const summary = String((product && product.summary) || 'No summary provided.');

    const bannerUrl =
      safeUrl(getBannerUrl(product)) ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff&size=600x320`;

    const blueprintUrl = safeUrl(getBlueprintUrl(product));
    const bbbUrl =
      safeUrl(product && product.platforms && product.platforms.BUILTBYBIT && product.platforms.BUILTBYBIT.url) || null;
    const sxUrl =
      safeUrl(product && product.platforms && product.platforms.SOURCEXCHANGE && product.platforms.SOURCEXCHANGE.url) ||
      null;

    const panels = Number(product && product.stats && product.stats.panels) || 0;
    const panelsDisplay = panels.toLocaleString();

    const priceInfo = formatPriceLabel(product);
    const priceLabel = priceInfo.label;
    const priceTextClass = priceLabel === 'FREE' ? 'text-emerald-300' : 'text-blue-300';

    const latestVersion = getLatestVersion(product);
    const latestLabel = latestVersion && latestVersion.name ? `v${latestVersion.name}` : null;
    const latestDate = latestVersion && latestVersion.created ? formatDate(latestVersion.created) : null;

    const buttons = [];
    if (blueprintUrl) {
      buttons.push({
        label: 'View on Blueprint',
        href: blueprintUrl,
        className:
          'inline-flex items-center justify-center px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors',
      });
    }
    if (bbbUrl) {
      buttons.push({
        label: 'BuiltByBit',
        href: bbbUrl,
        className:
          'inline-flex items-center justify-center px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold transition-colors border border-neutral-700',
      });
    }
    if (sxUrl) {
      buttons.push({
        label: 'SourceXchange',
        href: sxUrl,
        className:
          'inline-flex items-center justify-center px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold transition-colors border border-neutral-700',
      });
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-lg sm:text-xl font-semibold text-neutral-100 truncate">${escapeHtml(name)}</h3>
          <p class="text-neutral-400 text-sm mt-1 line-clamp-2">${escapeHtml(summary)}</p>
        </div>
        <span class="shrink-0 text-xs px-2 py-1 rounded-full ${typeBadgeClass}">
          ${typeLabel}
        </span>
      </div>

      <div class="mt-4 overflow-hidden rounded-lg border border-neutral-800/70">
        <img
          src="${escapeAttr(bannerUrl)}"
          alt="${escapeAttr(name)}"
          class="w-full h-32 object-cover"
          loading="lazy"
          decoding="async"
          onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(
            name,
          )}&background=3b82f6&color=fff&size=600x320'"
        >
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
        <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700 ${priceTextClass}">${escapeHtml(
          priceLabel,
        )}</span>
        <span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">${escapeHtml(
          panelsDisplay,
        )} active panels</span>
        ${
          latestLabel
            ? `<span class="px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700">Latest ${escapeHtml(
                latestLabel,
              )}</span>`
            : ''
        }
        ${
          latestDate
            ? `<span class="ml-auto text-neutral-500">Updated ${escapeHtml(latestDate)}</span>`
            : ''
        }
      </div>

      ${
        buttons.length
          ? `<div class="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-2">${buttons
              .map((b) => {
                return `<a href="${escapeAttr(b.href)}" target="_blank" rel="noopener noreferrer" class="${b.className}">${escapeHtml(
                  b.label,
                )}</a>`;
              })
              .join('')}</div>`
          : ''
      }
    `;

    return card;
  }

  function renderGrid(grid, items, emptyMessage) {
    if (!grid) return;
    grid.innerHTML = '';

    if (!items.length) {
      grid.innerHTML = `
        <div class="col-span-full text-center text-neutral-400">
          <p>${escapeHtml(emptyMessage)}</p>
        </div>
      `;
      return;
    }

    items.forEach((product) => {
      grid.appendChild(createCard(product));
    });
  }

  function renderAll(products) {
    const addonsGrid = document.getElementById('blueprint-addons-grid');
    const themesGrid = document.getElementById('blueprint-themes-grid');

    const list = Array.isArray(products) ? products : [];
    const themes = sortProducts(list.filter((p) => normalizeType(p && p.type) === 'theme'));
    const addons = sortProducts(list.filter((p) => normalizeType(p && p.type) !== 'theme'));

    setCount('blueprint-addon-count', addons.length);
    setCount('blueprint-theme-count', themes.length);

    renderGrid(addonsGrid, addons, 'No Blueprint addons found yet.');
    renderGrid(themesGrid, themes, 'No Blueprint themes found yet.');

    ensureMoreToggle(addonsGrid);
    ensureMoreToggle(themesGrid);

    const note = document.getElementById('blueprint-products-note');
    if (note) {
      const total = addons.length + themes.length;
      note.textContent = `Showing ${total.toLocaleString()} Blueprints | ${addons.length.toLocaleString()} addons | ${themes.length.toLocaleString()} themes`;
    }
  }

  function renderError(message) {
    const addonsGrid = document.getElementById('blueprint-addons-grid');
    const themesGrid = document.getElementById('blueprint-themes-grid');

    const html = `
      <div class="col-span-full text-center text-neutral-400">
        <p>${escapeHtml(message)}</p>
      </div>
    `;

    if (addonsGrid) addonsGrid.innerHTML = html;
    if (themesGrid) themesGrid.innerHTML = html;

    setCount('blueprint-addon-count', 0);
    setCount('blueprint-theme-count', 0);

    const note = document.getElementById('blueprint-products-note');
    if (note) note.textContent = '';
  }

  async function fetchProducts() {
    const res = await fetch(STATS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Request failed (${res.status}).`);

    const data = await res.json();
    const items = Array.isArray(data && data.blueprintExtensions) ? data.blueprintExtensions : [];

    // Keep only the fields we render/cache.
    return items.map((p) => ({
      id: p.id,
      name: p.name,
      identifier: p.identifier,
      summary: p.summary,
      type: p.type,
      banner: p.banner,
      platforms: p.platforms,
      stats: p.stats,
      versions: p.versions,
      created: p.created,
    }));
  }

  async function loadBlueprintProducts() {
    const addonsGrid = document.getElementById('blueprint-addons-grid');
    const themesGrid = document.getElementById('blueprint-themes-grid');
    if (!addonsGrid && !themesGrid) return;

    // Render cached content immediately (if available), then refresh in background.
    const cached = loadCache();
    if (cached && cached.length) renderAll(cached);

    try {
      const items = await fetchProducts();
      if (!items.length) {
        renderError('No Blueprint products found yet.');
        return;
      }

      saveCache(items);
      renderAll(items);
    } catch (err) {
      // If cache rendered, avoid replacing it with an error.
      if (cached && cached.length) return;
      renderError(err instanceof Error ? err.message : 'Unable to load products at this time.');
    }
  }

  document.addEventListener('DOMContentLoaded', loadBlueprintProducts);
})();
