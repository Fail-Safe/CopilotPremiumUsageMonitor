// Logging helper function to reduce code duplication
function log(message) {
  try {
    if (typeof window?.cpumWebviewLog === 'function') {
      window.cpumWebviewLog(message);
    }
  } catch {
    /* noop */
  }
}

// Top-level error banner renderer
function showErrorBanner(msg) {
  log('[showErrorBanner] called with: ' + JSON.stringify(msg));
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
      log('[showErrorBanner] banner appended to #error-banner-container');
    } else {
      document.body.prepend(banner);
      log('[showErrorBanner] banner prepended to body');
    }
  } else {
    log('[showErrorBanner] banner already exists, updating text');
  }
  banner.textContent = msg;
  log('[showErrorBanner] banner text set: ' + String(banner.textContent));
}

(function () {
  const vscode = acquireVsCodeApi ? acquireVsCodeApi() : undefined;
  const WIN = (typeof globalThis !== 'undefined' && globalThis.window)
    ? globalThis.window
    : (typeof window !== 'undefined' ? window : undefined);
  const $ = (sel) => document.querySelector(sel);
  let hasError = false; // track current error (stale data) state
  // Keep the latest config for renderSummary to reference
  let cfg = {};
  // Keep the latest summary payload so we can re-render when config changes
  let lastSummaryMsg = null;

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

  function formatRequests(num) {
    return Math.round(num).toLocaleString();
  }

  function formatYAxisValue(value) {
    if (!isFinite(value)) {
      return '0';
    }
    const abs = Math.abs(value);
    if (abs >= 1000) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    if (abs >= 1) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  }

  function escapeHtml(input) {
    if (input == null) return '';
    return String(input).replace(/[&<>"]/g, function (s) {
      switch (s) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return s;
      }
    });
  }

  function renderSummary({ budget, spend, pct, warnAtPercent, dangerAtPercent, included, includedUsed, includedPct, view }) {
    const summary = document.getElementById('summary');
    const warnRaw = Number(warnAtPercent ?? 75);
    const dangerRaw = Number(dangerAtPercent ?? 90);
    // Treat 0 as disabled (never trigger) to mirror status bar logic
    const warn = warnRaw > 0 ? warnRaw : Infinity;
    const danger = dangerRaw > 0 ? dangerRaw : Infinity;
    // Populate generated plans dropdown if present
    try {
      const plans = cfg.generatedPlans && Array.isArray(cfg.generatedPlans.plans) ? cfg.generatedPlans.plans : null;
      if (plans) {
        let planRow = document.getElementById('plan-row');
        if (!planRow) {
          planRow = document.createElement('label');
          planRow.id = 'plan-row';
          planRow.style.marginLeft = '12px';
          planRow.textContent = 'Plan:';
          const sel = document.createElement('select');
          sel.id = 'planSelect';
          sel.style.marginLeft = '8px';
          sel.style.minWidth = '220px';
          planRow.appendChild(sel);
          const controls = document.querySelector('.controls .right-group') || document.querySelector('.controls');
          if (controls) controls.appendChild(planRow);
        }
        const sel = document.getElementById('planSelect');
        if (sel) {
          // Clear then populate
          sel.innerHTML = '';
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = (cfg.plansPlaceholder || '(Select built-in plan)');
          sel.appendChild(placeholder);
          plans.forEach(p => {
            try {
              const o = document.createElement('option');
              o.value = p.id || p.name || '';
              o.textContent = p.name + (p.included ? ` (${p.included} incl)` : '');
              sel.appendChild(o);
            } catch { /* noop */ }
          });
          if (cfg.selectedPlanId) sel.value = cfg.selectedPlanId;
          sel.addEventListener('change', (e) => {
            const v = (e.target && e.target.value) ? e.target.value : '';
            vscode?.postMessage({ type: 'planSelected', planId: v });
          });
        }
      }
    } catch { }
    // Prefer precomputed values from the extension view-model when available
    if (view) {
      try {
        if (typeof view.budgetPct === 'number') pct = Math.max(0, Math.min(100, Math.round(view.budgetPct)));
        if (typeof view.included === 'number') included = view.included;
        if (typeof view.includedUsed === 'number') includedUsed = view.includedUsed;
        if (typeof view.includedPct === 'number') includedPct = view.includedPct;
      } catch { /* noop */ }
    }
    let barColor = (view && view.budgetColor) ? view.budgetColor : '#2d7d46'; // base green or centralized
    if (!view || !view.budgetColor) {
      if (pct >= danger) barColor = '#e51400';
      else if (pct >= warn) barColor = '#f0ad4e';
    }
    const startColor = lighten(barColor, 0.18);

    // Build the summary DOM using safe DOM APIs to avoid XSS risks
    const frag = (typeof document.createDocumentFragment === 'function') ? document.createDocumentFragment() : document.createElement('div');

    // Compute a human-friendly source label for the included limit to display above the included meter
    let limitSourceText = '';
    try {
      const customIncluded = Number(cfg.includedPremiumRequests || 0) > 0;
      const hasPlan = !!cfg.selectedPlanId;
      if (customIncluded) {
        limitSourceText = (typeof localize === 'function') ? localize('cpum.webview.limitSource.custom', 'Included limit: Custom value') : 'Included limit: Custom value';
      } else if (hasPlan) {
        let planName = cfg.selectedPlanId;
        try {
          const plans = cfg.generatedPlans && Array.isArray(cfg.generatedPlans.plans) ? cfg.generatedPlans.plans : [];
          const found = plans.find(p => (p.id || p.name) === cfg.selectedPlanId);
          if (found && found.name) planName = found.name;
        } catch { /* noop */ }
        if (!planName || planName === cfg.selectedPlanId) {
          const fallbackNames = {
            'copilot-free': 'Copilot Free',
            'copilot-pro': 'Copilot Pro',
            'copilot-proplus': 'Copilot Pro+',
            'copilot-business': 'Copilot Business',
            'copilot-enterprise': 'Copilot Enterprise'
          };
          if (fallbackNames[cfg.selectedPlanId]) planName = fallbackNames[cfg.selectedPlanId];
        }
        if (typeof localize === 'function') {
          let txt = localize('cpum.webview.limitSource.plan', 'Included limit: GitHub plan ({0})', planName);
          if (typeof txt === 'string' && txt.includes('{0}')) { try { txt = txt.replace('{0}', planName); } catch { /* noop */ } }
          limitSourceText = txt;
        } else {
          limitSourceText = `Included limit: GitHub plan (${planName})`;
        }
      } else {
        limitSourceText = (typeof localize === 'function') ? localize('cpum.webview.limitSource.billing', 'Included limit: Billing data') : 'Included limit: Billing data';
      }
    } catch { /* noop */ }
    // Ensure a safe default so UI tests can reliably assert presence of a billing fallback
    if (!limitSourceText) {
      limitSourceText = (typeof localize === 'function') ? localize('cpum.webview.limitSource.billing', 'Included limit: Billing data') : 'Included limit: Billing data';
    }

    // Add included requests meter if data is available
    if (included > 0) {
      const includedBarColor = (view && view.includedColor) ? view.includedColor : 'var(--chart-color, #007acc)'; // Prefer centralized
      const includedStartColor = lighten('#007acc', 0.18);
      // Clamp numerator for display; do not show explicit overage count in the label
      const shownNumerator = (view && typeof view.includedShown === 'number')
        ? view.includedShown
        : Math.min(includedUsed || 0, included || 0);
      const shownPct = (view && typeof view.includedPct === 'number')
        ? Math.max(0, Math.min(100, Math.round(view.includedPct)))
        : Math.min(100, Math.round(Math.min((includedPct || 0), 100)));
      const section = document.createElement('div');
      section.className = 'meter-section';

      const labelRow = document.createElement('div');
      labelRow.className = 'meter-label meter-label-row';

      const leftSpan = document.createElement('span');
      leftSpan.className = 'meter-label-left';
      leftSpan.textContent = `Included Premium Requests: ${formatRequests(shownNumerator)} / ${formatRequests(included)} (${shownPct}%)`;
      labelRow.appendChild(leftSpan);

      const limitSpan = document.createElement('span');
      limitSpan.className = 'limit-source-inline';
      limitSpan.textContent = limitSourceText || '';
      labelRow.appendChild(limitSpan);

      section.appendChild(labelRow);

      const meter = document.createElement('div');
      meter.className = 'meter';
      const fill = document.createElement('div');
      fill.className = 'fill';
      const fillWidth = Math.min(includedPct, 100);
      fill.style.width = `${fillWidth}%`;
      fill.style.background = `linear-gradient(to right, ${includedStartColor}, ${includedBarColor})`;
      meter.appendChild(fill);
      section.appendChild(meter);
      frag.appendChild(section);
    }

    // Add budget meter
    // Compute period text from current config so it persists across re-renders
    const orgForPeriod = (cfg.org || '').trim();
    const effectiveModeForPeriod = (cfg.mode === 'auto') ? (orgForPeriod ? 'org' : 'personal') : cfg.mode;
    const periodText = effectiveModeForPeriod === 'org' ? 'Current period: Last 28 days' : 'Current period: This month';
    const budgetSection = document.createElement('div');
    budgetSection.className = 'meter-section';
    const budgetLabel = document.createElement('div');
    budgetLabel.className = 'meter-label';
    budgetLabel.textContent = `Budget: $${budget.toFixed(2)} / Spend: $${spend.toFixed(2)} (${pct}%)`;
    budgetSection.appendChild(budgetLabel);

    const budgetMeter = document.createElement('div');
    budgetMeter.className = 'meter';
    const budgetFill = document.createElement('div');
    budgetFill.className = 'fill';
    budgetFill.style.width = `${Math.min(Math.max(0, Number(pct)), 100)}%`;
    budgetFill.style.background = `linear-gradient(to right, ${startColor}, ${barColor})`;
    budgetMeter.appendChild(budgetFill);
    budgetSection.appendChild(budgetMeter);
    frag.appendChild(budgetSection);

    const periodLine = document.createElement('div');
    periodLine.id = 'periodLine';
    periodLine.className = 'note';
    periodLine.textContent = periodText;
    frag.appendChild(periodLine);

    if (summary) {
      // Clear previous children then append our document fragment
      while (summary.firstChild) summary.removeChild(summary.firstChild);
      summary.appendChild(frag);
      // For the test harness (minimal DOM), ensure an innerHTML snapshot is present so tests
      // that assert against `summary.innerHTML` continue to work; we set it from textContent
      // which is safe because it contains escaped/plain text only.
      try {
        if (typeof summary.setAttribute === 'function') {
          // Build a conservative textual snapshot from child nodes (for minimal test DOM)
          const snapshot = (function buildText(n) {
            let t = '';
            try {
              if (n && typeof n.textContent === 'string' && n.textContent.trim()) t += n.textContent + ' ';
            } catch { /* noop */ }
            try {
              const children = n.children || [];
              for (let i = 0; i < children.length; i++) { t += buildText(children[i]); }
            } catch { /* noop */ }
            return t;
          })(summary);
          // Avoid setting innerHTML (recompiling DOM or reinterpreting as HTML) – instead store a
          // conservative text snapshot in a data attribute. Tests can read this attribute instead
          // of relying on `innerHTML`. Use escapeHtml to ensure it contains no special characters.
          try { summary.setAttribute('data-summary-snapshot', escapeHtml(snapshot.trim() || '')); } catch { /* noop */ }
        }
      } catch { /* noop */ }
    }
  }

  try { log('[webview.js] registering message listener'); } catch { /* noop */ }
  try { log('[webview.js] has WIN: ' + (!!WIN) + ' typeof WIN.addEventListener: ' + typeof (WIN && WIN.addEventListener)); } catch { }
  const __cpumHandler = (event) => {
    const msg = event.data;
    try { log('[Webview] Received message: ' + JSON.stringify(msg)); } catch { }
    if (msg.type === 'summary') {
      // Capture latest summary to allow re-render on config updates
      try { lastSummaryMsg = msg; } catch { /* noop */ }
      const summary = document.getElementById('summary');
      if (!hasError) { // only clear error visuals if no active error
        if (summary) {
          summary.classList.remove('summary-error');
          const unavailableMsg = document.getElementById('summary-unavailable');
          if (unavailableMsg) unavailableMsg.remove();
        }
      }
      renderSummary(msg);

      // Render usage history if available (experimental feature gated in extension)
      if (msg.usageHistory) {
        renderUsageHistory(msg.usageHistory);
      } else {
        const section = document.getElementById('usage-history-section');
        if (section) section.style.display = 'none';
      }
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
        cfg = msg.config || {};
        const modeSel = document.querySelector('#mode');
        if (modeSel && cfg.mode) {
          modeSel.value = cfg.mode;
        }
        // Re-render summary with the latest config so plan label and period reflect immediately
        if (lastSummaryMsg) {
          renderSummary(lastSummaryMsg);
        }
        // Note: The legacy fallback #limit-source element has been removed.
        // The "Included limit" label is rendered inline above the included meter by renderSummary().
        // Derive effective mode for downstream toggles
        const org = (cfg.org || '').trim();
        const effectiveMode = (cfg.mode === 'auto') ? (org ? 'org' : 'personal') : cfg.mode;
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
        // Mark summary as stale if in personal context without any token (secure or plaintext)
        try {
          const needsTokenPersonal = effectiveMode === 'personal' && !cfg.hasSecurePat && !cfg.residualPlaintext;
          try { log('[webview.js][config] needsTokenPersonal=' + String(needsTokenPersonal)); } catch { }
          if (needsTokenPersonal) {
            const summary = document.getElementById('summary');
            if (summary && !summary.classList.contains('summary-error')) {
              try { log('[webview.js][config] adding summary-error class'); } catch { }
              summary.classList.add('summary-error');
              if (!document.getElementById('summary-unavailable')) {
                const unavailable = document.createElement('div');
                unavailable.id = 'summary-unavailable';
                unavailable.textContent = cfg.noTokenStaleMessage || 'Awaiting secure token for personal spend updates.';
                unavailable.style.color = '#888';
                unavailable.style.fontWeight = 'bold';
                unavailable.style.marginTop = '12px';
                unavailable.style.fontSize = '16px';
                summary.appendChild(unavailable);
              }
            }
          }
          // Add a visible QuickPick button next to the select for a one-click flow
          let selectBtn = document.getElementById('selectPlanBtn');
          if (!selectBtn) {
            selectBtn = document.createElement('button');
            selectBtn.id = 'selectPlanBtn';
            selectBtn.className = 'btn';
            selectBtn.style.marginLeft = '8px';
            selectBtn.textContent = (cfg.plansSelectBtnText || 'Select built-in plan...');
            const planSelect = document.getElementById('planSelect');
            const parent = (planSelect && planSelect.parentElement) || document.querySelector('.controls .right-group') || document.querySelector('.controls') || document.body;
            parent.appendChild(selectBtn);
            selectBtn.addEventListener('click', () => {
              vscode?.postMessage({ type: 'invokeSelectPlan' });
            });
          } else {
            selectBtn.textContent = (cfg.plansSelectBtnText || 'Select built-in plan...');
          }
        } catch { }
        // Ensure a right-side meta stack exists under the controls for compact annotations
        try {
          let meta = document.getElementById('right-meta');
          if (!meta) {
            meta = document.createElement('div');
            meta.id = 'right-meta';
            const rightGroup = document.querySelector('.controls .right-group');
            if (rightGroup && rightGroup.parentElement) {
              rightGroup.parentElement.insertBefore(meta, rightGroup.nextSibling);
            } else {
              // Fallback: append at end of controls container
              const controls = document.querySelector('.controls');
              if (controls) controls.appendChild(meta);
            }
          }
        } catch { /* noop */ }

        // Ensure a full-width notes area exists directly beneath the buttons row
        try {
          let notes = document.getElementById('controls-notes');
          if (!notes) {
            notes = document.createElement('div');
            notes.id = 'controls-notes';
            const controlsRow = document.querySelector('.controls.controls-row') || document.querySelector('.controls-row');
            if (controlsRow && controlsRow.parentElement) {
              controlsRow.parentElement.insertBefore(notes, controlsRow.nextSibling);
            } else {
              const controls = document.querySelector('.controls');
              if (controls && controls.parentElement) {
                controls.parentElement.insertBefore(notes, controls.nextSibling);
              } else {
                document.body.appendChild(notes);
              }
            }
          }
        } catch { /* noop */ }

        // If a selected plan exists and a custom included override is set, surface a hint with one-click action beneath the buttons
        try {
          const hasPlan = !!cfg.selectedPlanId;
          const customIncluded = Number(cfg.includedPremiumRequests || 0) > 0;
          if (hasPlan && customIncluded) {
            let hint = document.getElementById('override-hint');
            const notes = document.getElementById('controls-notes');
            if (!hint) {
              hint = document.createElement('div');
              hint.id = 'override-hint';
              hint.className = 'notice-custom-override';
              const text = document.createElement('span');
              text.id = 'override-hint-text';
              text.textContent = (typeof localize === 'function')
                ? localize('cpum.webview.overrideHint.customIncluded', 'Using custom "Included Premium Requests". Plan value is not applied.')
                : 'Using custom "Included Premium Requests". Plan value is not applied.';
              const btn = document.createElement('button');
              btn.className = 'btn';
              btn.textContent = (typeof localize === 'function')
                ? localize('cpum.webview.overrideHint.usePlanValue', 'Use plan value')
                : 'Use plan value';
              btn.addEventListener('click', () => {
                vscode?.postMessage({ type: 'clearIncludedOverride' });
                hint?.remove();
              });
              hint.appendChild(text);
              hint.appendChild(btn);
              const host = notes || document.getElementById('right-meta') || document.querySelector('.controls');
              if (host) host.appendChild(hint);
            } else {
              // Move existing hint under the buttons if needed
              const notes = document.getElementById('controls-notes');
              if (notes && hint.parentElement !== notes) {
                notes.appendChild(hint);
              }
            }
          } else {
            const hint = document.getElementById('override-hint');
            if (hint) hint.remove();
          }
        } catch { /* noop */ }

        // We now show the "Included limit" inline above the meter only.
        // Secure token indicator (shows whenever a secure PAT exists). If residual plaintext also exists, use warning styling.
        let secureInd = document.getElementById('secure-token-indicator');
        if (cfg.hasSecurePat) {
          if (!secureInd) {
            secureInd = document.createElement('div');
            secureInd.id = 'secure-token-indicator';
            secureInd.style.padding = '2px 8px';
            secureInd.style.borderRadius = '12px';
            secureInd.style.fontSize = '11px';
            secureInd.style.display = 'inline-flex';
            secureInd.style.alignItems = 'center';
            secureInd.style.gap = '4px';
            secureInd.style.marginLeft = '8px';
            const icon = document.createElement('span');
            icon.id = 'secure-token-indicator-icon';
            secureInd.appendChild(icon);
            const txt = document.createElement('span');
            txt.id = 'secure-token-indicator-text';
            secureInd.appendChild(txt);
            const controls = document.querySelector('.controls .right-group') || document.querySelector('.controls');
            if (controls) controls.appendChild(secureInd);
          }
          // Update styling/content based on whether plaintext also present
          const iconSpan = secureInd.querySelector('#secure-token-indicator-icon');
          const textSpan = secureInd.querySelector('#secure-token-indicator-text');
          if (cfg.securePatOnly) {
            secureInd.style.background = 'var(--vscode-testing-iconPassed, #1b6e3b)';
            secureInd.style.color = '#fff';
            secureInd.title = cfg.secureTokenTitle || 'Secure token stored in VS Code Secret Storage (encrypted by your OS).';
            if (iconSpan) iconSpan.textContent = '🔐';
            if (textSpan) textSpan.textContent = (cfg.secureTokenText || 'Secure token set');
          } else {
            secureInd.style.background = 'var(--vscode-inputValidation-warningBackground, #fff8d1)';
            secureInd.style.color = 'var(--vscode-inputValidation-warningForeground, #5c4400)';
            secureInd.style.border = '1px solid var(--vscode-inputValidation-warningBorder, #d5b200)';
            secureInd.title = cfg.secureTokenTitleResidual || 'Secure token present (plaintext copy still in settings – clear it).';
            if (iconSpan) iconSpan.textContent = '🔐⚠️';
            if (textSpan) textSpan.textContent = (cfg.secureTokenTextResidual || 'Secure token (clear plaintext)');
          }
        } else if (secureInd) {
          secureInd.remove();
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
      // Build stats using DOM APIs instead of innerHTML to avoid XSS reproblems flagged by static analysis
      const stats = document.createElement('div');
      stats.className = 'stats';
      const spanWindow = document.createElement('span');
      spanWindow.textContent = `Window: ${new Date(m.since).toLocaleDateString()} → ${new Date(m.until).toLocaleDateString()}`;
      stats.appendChild(spanWindow);
      const spanDays = document.createElement('span');
      spanDays.textContent = `Days: ${m.days}`;
      stats.appendChild(spanDays);
      const spanEngaged = document.createElement('span');
      spanEngaged.textContent = `Engaged users (sum): ${m.engagedUsersSum}`;
      stats.appendChild(spanEngaged);
      const spanSuggestions = document.createElement('span');
      spanSuggestions.textContent = `Code suggestions (sum): ${m.codeSuggestionsSum}`;
      stats.appendChild(spanSuggestions);
      el.appendChild(stats);
      const summary = document.querySelector('#summary');
      summary?.appendChild(el);
    } else if (msg.type === 'billing') {
      const b = msg.billing;
      const el = document.createElement('div');
      el.className = 'metrics billing-micro';
      const includedLabel = b.userConfiguredIncluded ? 'Included (configured)' : 'Included';
      const priceLabel = b.userConfiguredPrice ? 'Price/request (configured)' : 'Price/request';
      const total = Number(b.totalQuantity || 0);
      const included = Number(b.totalIncludedQuantity || 0) || 0;
      const overage = Math.max(0, total - included);
      // micro-sparkline container
      const sparkline = document.createElement('div');
      sparkline.className = 'micro-sparkline';
      sparkline.setAttribute('role', 'img');
      sparkline.setAttribute('aria-label', 'Usage sparkline');
      sparkline.setAttribute('tabindex', '0');
      el.appendChild(sparkline);
      // badges container
      const badges = document.createElement('div');
      badges.className = 'badges';
      badges.setAttribute('role', 'group');
      badges.setAttribute('aria-label', 'Usage summary');
      const badgeIncluded = document.createElement('span');
      badgeIncluded.className = 'badge badge-primary';
      badgeIncluded.setAttribute('role', 'status');
      badgeIncluded.setAttribute('tabindex', '0');
      badgeIncluded.textContent = `${includedLabel}: ${included}`;
      badges.appendChild(badgeIncluded);
      const badgeUsed = document.createElement('span');
      badgeUsed.className = 'badge badge-used';
      badgeUsed.setAttribute('role', 'status');
      badgeUsed.setAttribute('tabindex', '0');
      badgeUsed.textContent = `${localize ? (localize('cpum.webview.used', 'Used')) : 'Used'}: ${total}`;
      badges.appendChild(badgeUsed);
      const badgeOverage = document.createElement('span');
      badgeOverage.className = 'badge badge-overage';
      badgeOverage.setAttribute('role', 'status');
      badgeOverage.setAttribute('tabindex', '0');
      const overageText = overage > 0 ? ` (${(overage * (b.pricePerPremiumRequest || 0.04)).toFixed(2)})` : '';
      badgeOverage.textContent = `${localize ? (localize('cpum.webview.overage', 'Overage')) : 'Overage'}: ${overage}${overageText}`;
      badges.appendChild(badgeOverage);
      const badgePrice = document.createElement('span');
      badgePrice.className = 'badge badge-price';
      badgePrice.setAttribute('role', 'status');
      badgePrice.setAttribute('tabindex', '0');
      badgePrice.textContent = `${priceLabel}: $${(b.pricePerPremiumRequest || 0.04).toFixed(2)}`;
      badges.appendChild(badgePrice);
      el.appendChild(badges);
      const summary = document.querySelector('#summary');
      summary?.appendChild(el);
      // Draw a simple sparkline using recent items if provided, otherwise a tiny placeholder
      try {
        const spark = el.querySelector('.micro-sparkline');
        const points = (b.items && Array.isArray(b.items)) ? b.items.slice(-24).map(i => Number(i.quantity || 0)) : [];
        if (points.length && spark) {
          const max = Math.max(...points, 1);
            while (spark.firstChild) spark.removeChild(spark.firstChild);
          points.forEach(p => {
            const bar = document.createElement('div');
            bar.className = 'spark-bar';
            bar.style.height = `${Math.round((p / max) * 100)}%`;
            spark.appendChild(bar);
          });
          // Announce summary to screen readers via aria-live region
          try {
            let live = document.getElementById('billing-live');
            if (!live) {
              live = document.createElement('div');
              live.id = 'billing-live';
              live.style.position = 'absolute';
              live.style.left = '-10000px';
              live.style.top = 'auto';
              live.style.width = '1px';
              live.style.height = '1px';
              live.setAttribute('aria-live', 'polite');
              document.body.appendChild(live);
            }
            live.textContent = `Usage: ${total} units, ${included} included, ${overage} overage.`;
          } catch { /* noop */ }
        } else if (spark) {
            while (spark.firstChild) spark.removeChild(spark.firstChild);
            const ph = document.createElement('div');
            ph.className = 'spark-placeholder';
            ph.textContent = '—';
            spark.appendChild(ph);
        }
      } catch { /* noop */ }
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
    } else if (msg.type === 'migrationHint') {
      // Show a discrete migration hint if legacy plaintext token present
      let hint = document.getElementById('migration-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'migration-hint';
        hint.style.background = 'var(--vscode-inputValidation-infoBackground, #e8f2ff)';
        hint.style.color = 'var(--vscode-inputValidation-infoForeground, #00457a)';
        hint.style.border = '1px solid var(--vscode-inputValidation-infoBorder, #5aa3e8)';
        hint.style.padding = '6px 10px';
        hint.style.borderRadius = '4px';
        hint.style.marginBottom = '10px';
        hint.style.fontSize = '12px';
        hint.style.display = 'flex';
        hint.style.alignItems = 'center';
        const icon = document.createElement('span');
        icon.textContent = '🔐';
        icon.style.marginRight = '6px';
        hint.appendChild(icon);
        const text = document.createElement('span');
        text.textContent = msg.message || 'Migrate token to secure storage.';
        hint.appendChild(text);
        const migrateBtn = document.createElement('button');
        migrateBtn.textContent = msg.buttonLabel || 'Migrate Now';
        migrateBtn.style.marginLeft = 'auto';
        migrateBtn.style.fontSize = '11px';
        migrateBtn.className = 'btn';
        migrateBtn.addEventListener('click', () => {
          if (/clear/i.test(migrateBtn.textContent)) {
            vscode?.postMessage({ type: 'clearPlaintextToken' });
          } else {
            vscode?.postMessage({ type: 'migrateToken' });
          }
        });
        hint.appendChild(migrateBtn);
        const container = document.getElementById('error-banner-container') || document.body;
        container.prepend(hint);
      }
    } else if (msg.type === 'migrationComplete') {
      const hint = document.getElementById('migration-hint');
      if (hint) hint.remove();
      // Show ephemeral success toast-like banner
      let done = document.getElementById('migration-success');
      if (!done) {
        done = document.createElement('div');
        done.id = 'migration-success';
        done.style.background = 'var(--vscode-testing-iconPassed, #1b6e3b)';
        done.style.color = '#fff';
        done.style.padding = '6px 10px';
        done.style.borderRadius = '4px';
        done.style.fontSize = '12px';
        done.style.marginBottom = '10px';
        done.style.display = 'flex';
        done.style.alignItems = 'center';
        const icon = document.createElement('span');
        icon.textContent = '✅';
        icon.style.marginRight = '6px';
        done.appendChild(icon);
        const text = document.createElement('span');
        text.textContent = msg.message || 'Token migrated.';
        done.appendChild(text);
        const container = document.getElementById('error-banner-container') || document.body;
        container.prepend(done);
        setTimeout(() => { try { done.remove(); } catch { } }, 6000);
      }
    } else if (msg.type === 'setTokenHint') {
      // Show a hint when no secure token is present (user cleared or never set)
      let hint = document.getElementById('set-token-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'set-token-hint';
        hint.style.background = 'var(--vscode-inputValidation-infoBackground, #e8f2ff)';
        hint.style.color = 'var(--vscode-inputValidation-infoForeground, #00457a)';
        hint.style.border = '1px solid var(--vscode-inputValidation-infoBorder, #5aa3e8)';
        hint.style.padding = '6px 10px';
        hint.style.borderRadius = '4px';
        hint.style.marginBottom = '10px';
        hint.style.fontSize = '12px';
        hint.style.display = 'flex';
        hint.style.alignItems = 'center';
        const icon = document.createElement('span');
        icon.textContent = '🔑';
        icon.style.marginRight = '6px';
        hint.appendChild(icon);
        const text = document.createElement('span');
        text.textContent = msg.message || 'Add a personal token for spend tracking.';
        hint.appendChild(text);
        const setBtn = document.createElement('button');
        setBtn.textContent = msg.buttonLabel || 'Set Token';
        setBtn.style.marginLeft = 'auto';
        setBtn.style.fontSize = '11px';
        setBtn.className = 'btn';
        setBtn.addEventListener('click', () => {
          vscode?.postMessage({ type: 'setTokenSecure' });
        });
        hint.appendChild(setBtn);
        const container = document.getElementById('error-banner-container') || document.body;
        container.prepend(hint);
      }
    }
  };
  (WIN && WIN.addEventListener) && WIN.addEventListener('message', __cpumHandler);
  // Test harness hook: expose the actual handler
  try { if (WIN) { WIN.onmessage = __cpumHandler; WIN.__cpumMessageHandler = __cpumHandler; } } catch { }

  const openSettingsBtn = $('#openSettings');
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      vscode?.postMessage({ type: 'openSettings' });
    });
    try {
      const style = document.createElement('style');
      style.textContent = `.overage{color:#e51400;font-weight:600;margin-left:6px}`; // Style for overage indicator
      document.head.appendChild(style);
    } catch { }
  }
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

  // Usage History Rendering Functions
  let currentTimeRange = 'all'; // Track selected time range
  let allSnapshots = null; // Store all snapshots for filtering

  function renderUsageHistory(historyData) {
    try { log('[renderUsageHistory] called with: ' + JSON.stringify(historyData)); } catch { }
    const section = document.getElementById('usage-history-section');

    if (!section) {
      return;
    }

    if (!historyData || !historyData.trend) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';

    const { trend, recentSnapshots } = historyData;

    // Store all snapshots for time range filtering
    if (recentSnapshots && recentSnapshots.length > 0) {
      allSnapshots = recentSnapshots;
    }

    // Set up time range selector if not already done
    const timeRangeSelect = document.getElementById('time-range-select');
    if (timeRangeSelect && !timeRangeSelect.dataset.initialized) {
      timeRangeSelect.dataset.initialized = 'true';
      timeRangeSelect.value = currentTimeRange;
      timeRangeSelect.addEventListener('change', (e) => {
        currentTimeRange = e.target.value;
        // Re-render with filtered snapshots
        if (allSnapshots && allSnapshots.length > 0) {
          const filtered = filterSnapshotsByTimeRange(allSnapshots, currentTimeRange);
          currentSnapshots = filtered;
          renderTrendChart(filtered);

          // Recalculate trend stats for the selected time range
          if (filtered.length > 1) {
            updateTrendStats(filtered);
          }
        }
      });
    }

    // Update trend stats
    if (trend) {
      document.getElementById('current-rate').textContent = trend.hourlyRate.toFixed(1);
      document.getElementById('daily-projection').textContent = Math.round(trend.dailyProjection);
      document.getElementById('weekly-projection').textContent = Math.round(trend.weeklyProjection);

      // Update trend direction
      const directionEl = document.getElementById('trend-direction');
      const confidenceEl = document.getElementById('trend-confidence');

      if (trend.trend === 'increasing') {
        directionEl.textContent = '↗ Rising';
        directionEl.style.color = '#e51400';
      } else if (trend.trend === 'decreasing') {
        directionEl.textContent = '↘ Falling';
        directionEl.style.color = '#2d7d46';
      } else {
        directionEl.textContent = '→ Stable';
        directionEl.style.color = 'var(--vscode-foreground)';
      }

      confidenceEl.textContent = trend.confidence + ' confidence';
    }

    // Render chart with filtered snapshots
    if (recentSnapshots && recentSnapshots.length > 1) {
      const filtered = filterSnapshotsByTimeRange(recentSnapshots, currentTimeRange);
      currentSnapshots = filtered; // Store for resize handling
      renderTrendChart(filtered);
    }

    // Render multi-month analysis if available
    if (historyData.multiMonthAnalysis) {
      renderMultiMonthAnalysis(historyData.multiMonthAnalysis);
    }
  }

  function filterSnapshotsByTimeRange(snapshots, range) {
    if (!snapshots || snapshots.length === 0) {
      return snapshots;
    }

    if (range === 'all') {
      return snapshots;
    }

    const now = Date.now();
    let cutoffTime = 0;

    switch (range) {
      case '24h':
        cutoffTime = now - (24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffTime = now - (30 * 24 * 60 * 60 * 1000);
        break;
      default:
        return snapshots;
    }

    return snapshots.filter(s => s.timestamp >= cutoffTime);
  }

  function updateTrendStats(snapshots) {
    if (!snapshots || snapshots.length < 2) {
      return;
    }

    // Calculate trend from filtered snapshots
    const sortedSnapshots = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
    const firstSnapshot = sortedSnapshots[0];
    const lastSnapshot = sortedSnapshots[sortedSnapshots.length - 1];

    const timeRangeMs = lastSnapshot.timestamp - firstSnapshot.timestamp;
    const timeRangeHours = timeRangeMs / (1000 * 60 * 60);

    if (timeRangeHours <= 0) {
      return;
    }

    const usageChange = lastSnapshot.totalQuantity - firstSnapshot.totalQuantity;
    const hourlyRate = usageChange / timeRangeHours;

    // Update stats
    document.getElementById('current-rate').textContent = hourlyRate.toFixed(1);
    document.getElementById('daily-projection').textContent = Math.round(hourlyRate * 24);
    document.getElementById('weekly-projection').textContent = Math.round(hourlyRate * 24 * 7);

    // Update trend direction
    const directionEl = document.getElementById('trend-direction');
    const confidenceEl = document.getElementById('trend-confidence');

    const changePercent = firstSnapshot.totalQuantity > 0
      ? (usageChange / firstSnapshot.totalQuantity) * 100
      : 0;

    if (Math.abs(changePercent) < 5) {
      directionEl.textContent = '→ Stable';
      directionEl.style.color = 'var(--vscode-foreground)';
      confidenceEl.textContent = 'medium confidence';
    } else if (changePercent > 0) {
      directionEl.textContent = '↗ Rising';
      directionEl.style.color = '#e51400';
      confidenceEl.textContent = (Math.abs(changePercent) > 20 ? 'high' : 'medium') + ' confidence';
    } else {
      directionEl.textContent = '↘ Falling';
      directionEl.style.color = '#2d7d46';
      confidenceEl.textContent = (Math.abs(changePercent) > 20 ? 'high' : 'medium') + ' confidence';
    }
  }

  function renderTrendChart(snapshots) {
    const canvas = document.getElementById('trend-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Get the device pixel ratio for high-DPI displays
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Get the container dimensions and set responsive canvas size
    const container = canvas.parentElement;
    const containerRect = container.getBoundingClientRect();
    const displayWidth = Math.max(300, containerRect.width - 20); // Min 300px, with some padding
    const displayHeight = Math.max(150, displayWidth * 0.33); // Maintain aspect ratio, min 150px

    // Set canvas display size
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    // Set canvas actual size for high-DPI
    canvas.width = displayWidth * devicePixelRatio;
    canvas.height = displayHeight * devicePixelRatio;

    // Scale the drawing context for high-DPI
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Use the display dimensions for calculations
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (snapshots.length < 2) return;

    // Get computed colors for the current theme
    const computedStyle = getComputedStyle(document.body);
    const chartLineColor = computedStyle.getPropertyValue('--chart-line-color') ||
      computedStyle.getPropertyValue('--vscode-textLink-foreground') ||
      '#007acc';
    const chartAxisColor = computedStyle.getPropertyValue('--chart-axis-color') ||
      computedStyle.getPropertyValue('--vscode-foreground') ||
      '#cccccc';
    const chartTextColor = computedStyle.getPropertyValue('--chart-text-color') ||
      computedStyle.getPropertyValue('--vscode-foreground') ||
      '#cccccc';

    try { log('Chart colors: ' + JSON.stringify({ chartLineColor, chartAxisColor, chartTextColor })); } catch { }

    // Set up chart styling with scaled line width for high-DPI
    ctx.strokeStyle = chartLineColor.trim();
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.fillStyle = chartLineColor.trim();

    // Calculate data ranges
    const minTime = snapshots[0].timestamp;
    const maxTime = snapshots[snapshots.length - 1].timestamp;
    const timeRange = maxTime - minTime;

    const quantities = snapshots.map(s => s.totalQuantity);
    const minQuantity = Math.min(...quantities);
    const maxQuantity = Math.max(...quantities);
    const quantityRange = maxQuantity - minQuantity;

    // Margin for chart (in display coordinates) - Updated v3
    const margin = {
      top: 20,
      right: 50,  // Updated: Match left margin for symmetry
      bottom: 40,
      left: 50
    };
    try { log('Chart margins: ' + JSON.stringify(margin)); } catch { }
    const chartWidth = displayWidth - margin.left - margin.right;
    const chartHeight = displayHeight - margin.top - margin.bottom;

    // Draw axes
    ctx.strokeStyle = chartAxisColor.trim();
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Y axis
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, displayHeight - margin.bottom);
    // X axis
    ctx.moveTo(margin.left, displayHeight - margin.bottom);
    ctx.lineTo(displayWidth - margin.right, displayHeight - margin.bottom);
    ctx.stroke();

    // Draw data line
    ctx.strokeStyle = chartLineColor.trim();
    ctx.lineWidth = 2;
    ctx.beginPath();

    snapshots.forEach((snapshot, index) => {
      const x = margin.left + (snapshot.timestamp - minTime) / timeRange * chartWidth;
      const y = displayHeight - margin.bottom - (snapshot.totalQuantity - minQuantity) / quantityRange * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw data points
    ctx.fillStyle = chartLineColor.trim();
    snapshots.forEach(snapshot => {
      const x = margin.left + (snapshot.timestamp - minTime) / timeRange * chartWidth;
      const y = displayHeight - margin.bottom - (snapshot.totalQuantity - minQuantity) / quantityRange * chartHeight;

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Add labels
    ctx.fillStyle = chartTextColor.trim();
    ctx.font = `12px var(--vscode-font-family)`;
    ctx.textAlign = 'center';

    // Time labels (simplified)
    const startTime = new Date(minTime);
    const endTime = new Date(maxTime);

    ctx.textAlign = 'left';
    ctx.fillText(startTime.toLocaleDateString(), margin.left, displayHeight - 10);
    ctx.textAlign = 'right'; // Right-align the end time so it stays within margins
    ctx.fillText(endTime.toLocaleDateString(), displayWidth - margin.right, displayHeight - 10);

    // Y axis labels
    ctx.textAlign = 'right';
    ctx.fillText(formatYAxisValue(minQuantity), margin.left - 10, displayHeight - margin.bottom);
    ctx.fillText(formatYAxisValue(maxQuantity), margin.left - 10, margin.top + 5);
  }

  // Store current snapshots for resize handling
  let currentSnapshots = null;

  // Add resize listener for responsive chart
  (WIN && WIN.addEventListener) && WIN.addEventListener('resize', () => {
    if (currentSnapshots && currentSnapshots.length > 1) {
      // Debounce the resize to avoid excessive re-renders
      try { clearTimeout(WIN.resizeTimeout); } catch { }
      try { WIN.resizeTimeout = setTimeout(() => { renderTrendChart(currentSnapshots); }, 150); } catch { setTimeout(() => { renderTrendChart(currentSnapshots); }, 150); }
    }
  });

  function renderMultiMonthAnalysis(analysis) {
    try { log('[renderMultiMonthAnalysis] called with: ' + JSON.stringify(analysis)); } catch { }

    const section = document.getElementById('multi-month-analysis-section');
    if (!section) {
      // Create the section dynamically if it doesn't exist
      const historySection = document.getElementById('usage-history-section');
      if (!historySection) return;

      const newSection = document.createElement('div');
      newSection.id = 'multi-month-analysis-section';
      newSection.className = 'section';
      newSection.style.marginTop = '20px';
      historySection.parentElement.insertBefore(newSection, historySection.nextSibling);
    }

    const container = document.getElementById('multi-month-analysis-section');
    if (!analysis || !analysis.dataMonths || analysis.dataMonths < 2) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    // Build the analysis DOM safely using DOM APIs to avoid innerHTML & XSS re-interpretation
    const frag = document.createDocumentFragment();
    const h3 = document.createElement('h3');
    h3.textContent = 'Multi-Month Analysis';
    frag.appendChild(h3);
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'analysis-summary';
    const analysisPeriodP = document.createElement('p');
    const monthsCount = `${analysis.dataMonths} month${analysis.dataMonths > 1 ? 's' : ''}`;
    analysisPeriodP.innerHTML = `<strong>Analysis Period:</strong> ${escapeHtml(String(analysis.dataMonths))} ${analysis.dataMonths > 1 ? 'months' : 'month'} of data`;
    summaryDiv.appendChild(analysisPeriodP);
    frag.appendChild(summaryDiv);

    // Growth Trends
    if (analysis.growthTrends && analysis.growthTrends.length > 0) {
      const growthDiv = document.createElement('div');
      growthDiv.className = 'growth-trends';
      growthDiv.style.marginTop = '15px';
      const gH4 = document.createElement('h4');
      gH4.textContent = '📈 Growth Trends';
      growthDiv.appendChild(gH4);
      analysis.growthTrends.forEach(trend => {
        const trendIcon = trend.direction === 'increasing' ? '↗' : trend.direction === 'decreasing' ? '↘' : '→';
        const trendColor = trend.direction === 'increasing' ? '#e51400' : trend.direction === 'decreasing' ? '#2d7d46' : 'inherit';
        const trendItem = document.createElement('div');
        trendItem.className = 'trend-item';
        trendItem.style.margin = '8px 0';
        trendItem.style.padding = '8px';
        trendItem.style.background = 'var(--vscode-editor-background)';
        trendItem.style.borderLeft = '3px solid ' + trendColor;
        const metricLine = document.createElement('div');
        const metricStrong = document.createElement('strong');
        metricStrong.textContent = String(trend.metric) + ':';
        metricLine.appendChild(metricStrong);
        const span = document.createElement('span');
        span.style.color = trendColor;
        span.textContent = `${trendIcon} ${trend.direction}`;
        metricLine.appendChild(document.createTextNode(' '));
        metricLine.appendChild(span);
        trendItem.appendChild(metricLine);
        const statsLine = document.createElement('div');
        statsLine.style.fontSize = '0.9em';
        statsLine.style.marginTop = '4px';
        statsLine.textContent = `Average: ${trend.avgValue.toFixed(1)} | Change: ${(trend.changePercent > 0 ? '+' : '') + trend.changePercent.toFixed(1)}%`;
        trendItem.appendChild(statsLine);
        if (trend.significance !== 'none') {
          const significanceLine = document.createElement('div');
          significanceLine.style.fontSize = '0.85em';
          significanceLine.style.opacity = '0.8';
          significanceLine.style.marginTop = '2px';
          significanceLine.textContent = `Significance: ${String(trend.significance)}`;
          trendItem.appendChild(significanceLine);
        }
        growthDiv.appendChild(trendItem);
      });
      frag.appendChild(growthDiv);
    }

    // Predictions
    if (analysis.predictions && analysis.predictions.length > 0) {
      const predDiv = document.createElement('div');
      predDiv.className = 'predictions';
      predDiv.style.marginTop = '15px';
      const predH = document.createElement('h4');
      predH.textContent = '🔮 Next Month Predictions';
      predDiv.appendChild(predH);
      analysis.predictions.forEach(pred => {
        const predItem = document.createElement('div');
        predItem.className = 'prediction-item';
        predItem.style.margin = '8px 0';
        predItem.style.padding = '8px';
        predItem.style.background = 'var(--vscode-editor-background)';
        const predMonthLine = document.createElement('div');
        const predStrong = document.createElement('strong');
        predStrong.textContent = String(pred.month) + ':';
        predMonthLine.appendChild(predStrong);
        predItem.appendChild(predMonthLine);
        const predUsageLine = document.createElement('div');
        predUsageLine.style.fontSize = '0.9em';
        predUsageLine.style.marginTop = '4px';
        predUsageLine.textContent = `Predicted usage: ${Math.round(pred.predictedUsage)} ± ${Math.round(pred.confidenceInterval)}`;
        predItem.appendChild(predUsageLine);
        const predConfidenceLine = document.createElement('div');
        predConfidenceLine.style.fontSize = '0.85em';
        predConfidenceLine.style.opacity = '0.8';
        predConfidenceLine.textContent = `Confidence: ${String(pred.confidence)}`;
        predItem.appendChild(predConfidenceLine);
        predDiv.appendChild(predItem);
      });
      frag.appendChild(predDiv);
    }

    // Seasonality
    if (analysis.seasonality && analysis.seasonality.detected) {
      const seasonalityDiv = document.createElement('div');
      seasonalityDiv.className = 'seasonality';
      seasonalityDiv.style.marginTop = '15px';
      const seasonH = document.createElement('h4');
      seasonH.textContent = '📅 Seasonality Pattern';
      seasonalityDiv.appendChild(seasonH);
      const seasonInner = document.createElement('div');
      seasonInner.style.padding = '8px';
      seasonInner.style.background = 'var(--vscode-editor-background)';
      const patternLine = document.createElement('div');
      const pr = document.createElement('strong');
      pr.textContent = 'Pattern:';
      patternLine.appendChild(pr);
      patternLine.appendChild(document.createTextNode(' ' + String(analysis.seasonality.pattern)));
      seasonInner.appendChild(patternLine);
      const peakLine = document.createElement('div');
      peakLine.style.fontSize = '0.9em';
      peakLine.style.marginTop = '4px';
      peakLine.innerHTML = `<strong>Peak Months:</strong> ${escapeHtml(String(analysis.seasonality.peakMonths.join(', ')))}`;
      seasonInner.appendChild(peakLine);
      const lowLine = document.createElement('div');
      lowLine.style.fontSize = '0.9em';
      lowLine.style.marginTop = '4px';
      lowLine.innerHTML = `<strong>Low Months:</strong> ${escapeHtml(String(analysis.seasonality.lowMonths.join(', ')))}`;
      seasonInner.appendChild(lowLine);
      const varLine = document.createElement('div');
      varLine.style.fontSize = '0.9em';
      varLine.style.marginTop = '4px';
      varLine.innerHTML = `<strong>Variation:</strong> ${escapeHtml(String(analysis.seasonality.variance.toFixed(1)))}%`;
      seasonInner.appendChild(varLine);
      seasonalityDiv.appendChild(seasonInner);
      frag.appendChild(seasonalityDiv);
    }

    // Anomalies
    if (analysis.anomalies && analysis.anomalies.length > 0) {
      const anomaliesDiv = document.createElement('div');
      anomaliesDiv.className = 'anomalies';
      anomaliesDiv.style.marginTop = '15px';
      const anH = document.createElement('h4');
      anH.textContent = '⚠️ Anomalies Detected';
      anomaliesDiv.appendChild(anH);
      analysis.anomalies.forEach(anomaly => {
        const severityColor = anomaly.severity === 'high' ? '#e51400' : anomaly.severity === 'medium' ? '#f59d00' : '#f59d00';
        const anomalyItem = document.createElement('div');
        const aMonth = document.createElement('div');
        const aStrong = document.createElement('strong');
        aStrong.textContent = anomaly.month + ':';
        aMonth.appendChild(aStrong);
        aMonth.appendChild(document.createTextNode(' ' + anomaly.type));
        anomalyItem.appendChild(aMonth);
        const expectedLine = document.createElement('div');
        expectedLine.style.fontSize = '0.9em';
        expectedLine.style.marginTop = '4px';
        expectedLine.textContent = `Expected: ${Math.round(anomaly.expected)} | Actual: ${Math.round(anomaly.actual)} | Deviation: ${(anomaly.deviation > 0 ? '+' : '') + anomaly.deviation.toFixed(1)}%`;
        anomalyItem.appendChild(expectedLine);
        const severityLine = document.createElement('div');
        severityLine.style.fontSize = '0.85em';
        severityLine.style.opacity = '0.8';
        severityLine.style.marginTop = '2px';
        severityLine.textContent = `Severity: ${anomaly.severity}`;
        anomalyItem.appendChild(severityLine);
        anomaliesDiv.appendChild(anomalyItem);
      });
      frag.appendChild(anomaliesDiv);
    }

    // Insights
    if (analysis.insights && analysis.insights.length > 0) {
      const insightsDiv = document.createElement('div');
      insightsDiv.className = 'insights';
      insightsDiv.style.marginTop = '15px';
      const insightsH = document.createElement('h4');
      insightsH.textContent = '💡 Insights';
      insightsDiv.appendChild(insightsH);
      const insightsUl = document.createElement('ul');
      insightsUl.style.margin = '8px 0';
      insightsUl.style.paddingLeft = '20px';
      analysis.insights.forEach(insight => {
        html += '<li style="margin: 4px 0; font-size: 0.95em;">' + escapeHtml(insight) + '</li>';
      });
      analysis.insights.forEach(insight => {
        const li = document.createElement('li');
        li.style.margin = '4px 0';
        li.style.fontSize = '0.95em';
        li.textContent = insight;
        insightsUl.appendChild(li);
      });
      insightsDiv.appendChild(insightsUl);
      frag.appendChild(insightsDiv);
    }

    // Clear container and append our safe DOM fragment
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(frag);
  }

  vscode?.postMessage({ type: 'getConfig' });
})();
