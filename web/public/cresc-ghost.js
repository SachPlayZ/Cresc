// cresc-ghost.js — Cresc paywall snippet for Ghost blogs.
// Inject via Ghost Admin → Settings → Code Injection → Site Header (NOT footer):
//   <script src="https://your-cresc-domain.com/cresc-ghost.js" data-site="<creatorId>"></script>
//
// Must be in the header, not the footer. Header injection runs before the browser
// paints the post body, so the synchronous cloak below applies before first paint —
// a footer script only runs after the full article is already visible, causing a
// flash of unpaywalled content followed by a late, easy-to-miss clip.
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

  var CONTENT_SELECTORS = '.gh-content,.post-content,article .content,article';

  // Cloak immediately, synchronously, before the body has even been parsed — content
  // is never shown at full height, regardless of how long the status fetch takes.
  var cloak = document.createElement('style');
  cloak.id = 'cresc-cloak';
  cloak.textContent = CONTENT_SELECTORS + '{max-height:300px!important;overflow:hidden!important;position:relative!important;}';
  document.head.appendChild(cloak);

  function uncloak() {
    var el = document.getElementById('cresc-cloak');
    if (el) el.parentNode.removeChild(el);
  }

  fetch(
    crescBase + '/api/ghost/post-status?site=' + encodeURIComponent(site) +
    '&slug=' + encodeURIComponent(slug)
  )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.paywalled) { uncloak(); return; }

      function apply() {
        var content = document.querySelector(CONTENT_SELECTORS);
        if (!content) { uncloak(); return; }

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
          'font-size:0.95rem;transition:opacity 0.15s;"></a>' +
          '<p style="font-size:0.75rem;color:#aaa;margin:0.5rem 0 0;font-family:sans-serif;">' +
          'EIP-3009 signed offchain · zero gas · sub-second settlement' +
          '</p>';

        // Set via textContent, not string concatenation into innerHTML — priceDisplay
        // comes from the API response and must never be interpreted as markup.
        var unlockBtn = overlay.querySelector('#cresc-unlock-btn');
        if (unlockBtn) unlockBtn.textContent = 'Unlock for ' + data.priceDisplay + ' →';

        content.appendChild(overlay);
        uncloak(); // the element's own inline clip now owns it — drop the generic rule
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
      } else {
        apply();
      }
    })
    .catch(function () { uncloak(); /* silently ignore — don't break the blog */ });
})();
