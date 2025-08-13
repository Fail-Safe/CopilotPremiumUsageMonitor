// Top-level error banner renderer
function showErrorBanner(msg) {
  console.log('[showErrorBanner] called with:', msg);
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.style.background = 'var(--vscode-editorError-background, #fdd)';
    banner.style.color = 'var(--vscode-editorError-foreground, #a00)';
    banner.style.padding = '10px 16px';
    banner.style.marginBottom = '12px';
    banner.style.borderRadius = '6px';
    banner.style.fontWeight = 'bold';
    banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
    banner.style.zIndex = '9999';
    banner.style.position = 'relative';
    const container = document.getElementById('error-banner-container');
    if (container) {
      container.innerHTML = '';
      container.appendChild(banner);
      console.log('[showErrorBanner] banner appended to #error-banner-container');
    } else {
      document.body.prepend(banner);
      console.log('[showErrorBanner] banner prepended to body');
    }
  } else {
    console.log('[showErrorBanner] banner already exists, updating text');
  }
  banner.textContent = msg;
  console.log('[showErrorBanner] banner text set:', banner.textContent);
}

(function () {
  const vscode = acquireVsCodeApi ? acquireVsCodeApi() : undefined;
  const $ = (sel) => document.querySelector(sel);
  let hasError = false; // track current error (stale data) state

  function lighten(hex, amount) {
    // hex like #rrggbb; amount 0..1
    if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return hex;
    const h = hex[0] === '#' ? hex.slice(1) : hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const lr = Math.min(255, Math.round(r + (255 - r) * amount));
    const lg = Math.min(255, Math.round(g + (255 - g) * amount));
    const lb = Math.min(255, Math.round(b + (255 - b) * amount));
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(lr)}${toHex(lg)}${toHex(lb)}`;
  }

  function renderSummary({ budget, spend, pct, warnAtPercent, dangerAtPercent }) {
    const summary = $('#summary');
    const warnRaw = Number(warnAtPercent ?? 75);
    const dangerRaw = Number(dangerAtPercent ?? 90);
    // Treat 0 as disabled (never trigger) to mirror status bar logic
    const warn = warnRaw > 0 ? warnRaw : Infinity;
    const danger = dangerRaw > 0 ? dangerRaw : Infinity;
    let barColor = '#2d7d46'; // base green
    if (pct >= danger) barColor = '#e51400';
    else if (pct >= warn) barColor = '#f0ad4e';
    const startColor = lighten(barColor, 0.18);
    summary.innerHTML = `
      <div class="meter">
        <div class="fill" style="width:${pct}%; background: linear-gradient(to right, ${startColor}, ${barColor});"></div>
      </div>
      <div class="stats">
        <div class="stats-left">
          <span>Budget: $${budget.toFixed(2)}</span>
          <span>Spend: $${spend.toFixed(2)}</span>
          <span>Used: ${pct}%</span>
        </div>
        <div id="periodLine" class="note"></div>
      </div>
    `;
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    console.log('[Webview] Received message:', msg);
    if (msg.type === 'summary') {
      const summary = document.getElementById('summary');
      if (!hasError) { // only clear error visuals if no active error
        if (summary) {
          summary.classList.remove('summary-error');
          const unavailableMsg = document.getElementById('summary-unavailable');
          if (unavailableMsg) unavailableMsg.remove();
        }
      }
      renderSummary(msg);
      if (hasError && summary) {
        summary.classList.add('summary-error');
      }
    } else if (msg.type === 'error') {
      showErrorBanner(msg.message);
      // Gray out summary and show unavailable message
      const summary = document.getElementById('summary');
      if (summary) {
        hasError = true;
        summary.classList.add('summary-error');
        if (!document.getElementById('summary-unavailable')) {
          const unavailable = document.createElement('div');
          unavailable.id = 'summary-unavailable';
          unavailable.textContent = 'Data unavailable due to sync issue.';
          unavailable.style.color = '#888';
          unavailable.style.fontWeight = 'bold';
          unavailable.style.marginTop = '12px';
          unavailable.style.fontSize = '16px';
          summary.appendChild(unavailable);
        }
      }
    } else if (msg.type === 'notice') {
      const wrap = document.createElement('div');
      wrap.className = `notice ${msg.severity || 'info'}`;
      const text = document.createElement('span');
      text.textContent = msg.text || 'Notice';
      wrap.appendChild(text);
      if (msg.helpAction) {
        const btn = document.createElement('button');
        btn.textContent = msg.dismissText || "Don't show again";
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', () => {
          vscode?.postMessage({ type: 'dismissFirstRun' });
          wrap.remove();
        });
        wrap.appendChild(btn);
      }
      if (msg.docUrl) {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = msg.learnMoreText || 'Learn more';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          vscode?.postMessage({ type: 'openExternal', url: msg.docUrl });
        });
        wrap.appendChild(document.createTextNode(' '));
        wrap.appendChild(link);
      }
      if (msg.budgetsUrl) {
        const link2 = document.createElement('a');
        link2.href = '#';
        link2.textContent = msg.openBudgetsText || 'Open budgets';
        link2.style.marginLeft = '8px';
        link2.addEventListener('click', (e) => {
          e.preventDefault();
          vscode?.postMessage({ type: 'openExternal', url: msg.budgetsUrl });
        });
        wrap.appendChild(link2);
      }
      document.querySelector('#summary')?.prepend(wrap);
    } else if (msg.type === 'config') {
      // Initialize UI controls from config and sensible defaults
      try {
        const cfg = msg.config || {};
        const modeSel = document.querySelector('#mode');
        if (modeSel && cfg.mode) {
          modeSel.value = cfg.mode;
        }
        // Period line based on mode + org
        const org = (cfg.org || '').trim();
        const effectiveMode = (cfg.mode === 'auto') ? (org ? 'org' : 'personal') : cfg.mode;
        const periodEl = document.querySelector('#periodLine');
        if (periodEl) {
          periodEl.textContent = effectiveMode === 'org' ? 'Current period: Last 28 days' : 'Current period: This month';
        }
        // Hide mode row if auto applies and org is configured
        const modeRow = document.querySelector('#modeRow');
        if (modeRow && cfg.mode === 'auto' && org) {
          modeRow.style.display = 'none';
        } else if (modeRow) {
          modeRow.style.display = '';
        }
        // Show/Hide Sign in: needed only for org metrics when no session and no PAT
        const signInBtn = document.querySelector('#signIn');
        if (signInBtn) {
          const needsOrg = effectiveMode === 'org';
          const hasPat = !!cfg.hasPat; // PAT suffices for both personal and org endpoints
          const hasSession = !!cfg.hasSession;
          signInBtn.style.display = (needsOrg && !hasPat && !hasSession) ? '' : 'none';
        }
      } catch { }
    } else if (msg.type === 'clearError') {
      // Clear stale/error state
      hasError = false;
      const banner = document.getElementById('error-banner');
      if (banner) banner.remove();
      const summary = document.getElementById('summary');
      if (summary) {
        summary.classList.remove('summary-error');
        const unavailableMsg = document.getElementById('summary-unavailable');
        if (unavailableMsg) unavailableMsg.remove();
      }
    } else if (msg.type === 'metrics') {
      const m = msg.metrics;
      const el = document.createElement('div');
      el.className = 'metrics';
      el.innerHTML = `
        <div class="stats">
          <span>Window: ${new Date(m.since).toLocaleDateString()} → ${new Date(m.until).toLocaleDateString()}</span>
          <span>Days: ${m.days}</span>
          <span>Engaged users (sum): ${m.engagedUsersSum}</span>
          <span>Code suggestions (sum): ${m.codeSuggestionsSum}</span>
        </div>
      `;
      const summary = document.querySelector('#summary');
      summary?.appendChild(el);
    } else if (msg.type === 'billing') {
      const b = msg.billing;
      const el = document.createElement('div');
      el.className = 'metrics';
      el.innerHTML = `
        <div class="stats">
          <span>Copilot spend (this period): $${(b.totalNetAmount || 0).toFixed(2)}</span>
          <span>Copilot units: ${b.totalQuantity || 0}</span>
        </div>
      `;
      const summary = document.querySelector('#summary');
      summary?.appendChild(el);
    } else if (msg.type === 'iconOverrideWarning') {
      // Non-fatal warning banner (distinct styling from error) with higher contrast
      let banner = document.getElementById('icon-override-warning');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'icon-override-warning';
        banner.setAttribute('role', 'alert');
        // Use a proper warning background (light) and strong foreground for readability
        banner.style.background = 'var(--vscode-inputValidation-warningBackground, var(--vscode-editorWarning-background, #fff8d1))';
        banner.style.color = 'var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground, #5c4400))';
        banner.style.border = '1px solid var(--vscode-inputValidation-warningBorder, #d5b200)';
        banner.style.padding = '8px 14px';
        banner.style.marginBottom = '10px';
        banner.style.borderRadius = '5px';
        banner.style.fontWeight = '600';
        banner.style.display = 'flex';
        banner.style.alignItems = 'center';
        banner.style.gap = '8px';
        // Icon (optional)
        const icon = document.createElement('span');
        icon.textContent = '⚠️';
        icon.setAttribute('aria-hidden', 'true');
        banner.appendChild(icon);
        const text = document.createElement('span');
        text.textContent = (msg.message || 'Invalid icon override; using default.');
        banner.appendChild(text);
        const close = document.createElement('button');
        close.textContent = '×';
        close.setAttribute('aria-label', 'Dismiss');
        close.style.marginLeft = 'auto';
        close.style.background = 'transparent';
        close.style.border = 'none';
        close.style.cursor = 'pointer';
        close.style.fontSize = '16px';
        close.style.color = 'inherit';
        close.addEventListener('click', () => banner.remove());
        banner.appendChild(close);
        const container = document.getElementById('error-banner-container');
        if (container) {
          container.prepend(banner);
        } else {
          document.body.prepend(banner);
        }
      } else {
        // Update message text (second child after icon)
        const textNode = banner.querySelector('span:nth-of-type(2)');
        if (textNode) textNode.textContent = (msg.message || textNode.textContent);
      }
    } else if (msg.type === 'clearIconOverrideWarning') {
      const banner = document.getElementById('icon-override-warning');
      if (banner) banner.remove();
    }
  });

  $('#openSettings').addEventListener('click', () => {
    vscode?.postMessage({ type: 'openSettings' });
  });
  const signInBtn = document.querySelector('#signIn');
  if (signInBtn) {
    signInBtn.addEventListener('click', () => {
      vscode?.postMessage({ type: 'signIn' });
    });
  }
  const refreshBtn = document.querySelector('#refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const mode = document.querySelector('#mode')?.value || 'auto';
      vscode?.postMessage({ type: 'refresh', mode });
    });
  }

  const helpBtn = document.querySelector('#help');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      vscode?.postMessage({ type: 'help' });
    });
  }

  vscode?.postMessage({ type: 'getConfig' });
})();
