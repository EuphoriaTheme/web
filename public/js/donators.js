// Fetch and display donators from Euphoria Development API.
(() => {
  const API_URL = 'https://api.euphoriadevelopment.uk/donators';

  function escapeHtml(input) {
    return String(input || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function createDonatorCard(donator) {
    const name = donator && donator.Name ? String(donator.Name) : 'Unknown';
    const donation = donator && donator.Donation ? String(donator.Donation) : '';

    const href = safeUrl(donator && donator.Link);
    const imageUrl = safeUrl(donator && donator.Image);
    const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff&size=96`;

    const el = href ? document.createElement('a') : document.createElement('article');
    if (href) {
      el.href = href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }

    el.className = 'glass rounded-lg p-4 sm:p-6 shadow border border-neutral-800 card-hover text-left';

    el.innerHTML = `
      <div class="flex items-start gap-3">
        <img
          src="${escapeHtml(imageUrl || fallbackAvatar)}"
          alt="${escapeHtml(name)}"
          class="w-12 h-12 sm:w-14 sm:h-14 rounded-full border border-neutral-700 object-cover shrink-0"
          loading="lazy"
          decoding="async"
          onerror="this.onerror=null;this.src='${fallbackAvatar}'"
        >

        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-3">
            <h3 class="text-sm sm:text-base font-semibold text-neutral-100 truncate">${escapeHtml(name)}</h3>
            ${
              donation
                ? `<span class="shrink-0 text-xs px-2 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">${escapeHtml(
                    donation,
                  )}</span>`
                : `<span class="shrink-0 text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">Supporter</span>`
            }
          </div>
          <p class="text-neutral-400 text-sm mt-1">Thank you for supporting Euphoria Development.</p>
        </div>
      </div>
    `;

    return el;
  }

  async function loadDonators() {
    const grid = document.getElementById('donators-grid');
    if (!grid) return;

    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
      const donators = await response.json();

      grid.innerHTML = '';

      const items = Array.isArray(donators) ? donators : [];
      if (!items.length) {
        grid.innerHTML = `
          <div class="col-span-full text-center text-neutral-400">
            <p>No donators found yet.</p>
          </div>
        `;
        return;
      }

      items.forEach((donator) => {
        grid.appendChild(createDonatorCard(donator));
      });

      ensureMoreToggle(grid);
    } catch (error) {
      console.error('Error fetching donators:', error);
      grid.innerHTML = `
        <div class="col-span-full text-center text-neutral-400">
          <p>Unable to load donators at this time.</p>
        </div>
      `;
    }
  }

  document.addEventListener('DOMContentLoaded', loadDonators);
})();

