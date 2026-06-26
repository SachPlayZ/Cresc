// cresc-ghost.js — Cresc paywall snippet for Ghost blogs.
// Inject via Ghost Admin → Settings → Code Injection → Site Footer:
//   <script src="https://your-cresc-domain.com/cresc-ghost.js" data-site="<creatorId>"></script>
(function () {
  var script = document.currentScript;
  if (!script) return;

  var site = script.getAttribute('data-site');
  if (!site) return;

  var segments = window.location.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  var slug = segments[segments.length - 1];
  if (!slug || slug === '/') return;

  var scriptSrc = script.getAttribute('src') || '';
  var crescBase = scriptSrc.replace(/\/cresc-ghost\.js.*$/, '');
  if (!crescBase) crescBase = 'https://cresc.app';

  fetch(
    crescBase + '/api/ghost/post-status?site=' + encodeURIComponent(site) +
    '&slug=' + encodeURIComponent(slug)
  )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.paywalled) return;

      var content =
        document.querySelector('.gh-content') ||
        document.querySelector('.post-content') ||
        document.querySelector('article .content') ||
        document.querySelector('article');
      if (!content) return;

      content.style.cssText = 'position:relative;overflow:hidden;max-height:300px;';

      var overlay = document.createElement('div');
      overlay.style.cssText =
        'position:absolute;bottom:0;left:0;right:0;height:260px;' +
        'background:linear-gradient(to bottom,transparent 0%,#ffffff 55%);' +
        'display:flex;flex-direction:column;align-items:center;' +
        'justify-content:flex-end;padding:0 1rem 2.5rem;text-align:center;';

      var unlockHref =
        crescBase + '/read?slug=' + encodeURIComponent(slug) +
        '&site=' + encodeURIComponent(site);

      overlay.innerHTML =
        '<p style="font-size:0.8rem;color:#888;margin:0 0 0.6rem;font-family:monospace;letter-spacing:0.05em;">' +
        'HTTP 402 · AI-priced · Circle Gateway · Arc Testnet' +
        '</p>' +
        '<a id="cresc-unlock-btn" href="' + unlockHref + '" ' +
        'style="display:inline-block;background:#0f172a;color:#fff;padding:0.7rem 2rem;' +
        'border-radius:8px;text-decoration:none;font-weight:600;font-family:sans-serif;' +
        'font-size:0.95rem;transition:opacity 0.15s;">' +
        'Unlock for ' + data.priceDisplay + ' →' +
        '</a>' +
        '<p style="font-size:0.75rem;color:#aaa;margin:0.5rem 0 0;font-family:sans-serif;">' +
        'EIP-3009 signed offchain · zero gas · sub-second settlement' +
        '</p>';

      content.appendChild(overlay);
    })
    .catch(function () { /* silently ignore — don't break the blog */ });
})();
