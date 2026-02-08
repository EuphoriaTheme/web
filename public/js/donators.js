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

