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
  const WIN = (typeof globalThis !== 'undefined' && globalThis.window)
    ? globalThis.window
    : (typeof window !== 'undefined' ? window : undefined);
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

  function formatRequests(num) {
    return Math.round(num).toLocaleString();
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

    // Build the HTML with optional included requests meter
    let html = '';

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
      html += `
        <div class="meter-section">
      <div class="meter-label">Included Premium Requests: ${formatRequests(shownNumerator)} / ${formatRequests(included)} (${shownPct}%)</div>
          <div class="meter">
            <div class="fill" style="width:${Math.min(includedPct, 100)}%; background: linear-gradient(to right, ${includedStartColor}, ${includedBarColor});"></div>
          </div>
        </div>
      `;
    }

    // Add budget meter
    html += `
      <div class="meter-section">
        <div class="meter-label">Budget: $${budget.toFixed(2)} / Spend: $${spend.toFixed(2)} (${pct}%)</div>
        <div class="meter">
          <div class="fill" style="width:${pct}%; background: linear-gradient(to right, ${startColor}, ${barColor});"></div>
        </div>
      </div>
      <div id="periodLine" class="note"></div>
    `;

    if (summary) {
      summary.innerHTML = html;
    }
  }

  console.log('[webview.js] registering message listener');
  try { console.log('[webview.js] has WIN:', !!WIN, 'typeof WIN.addEventListener:', typeof (WIN && WIN.addEventListener)); } catch { }
  const __cpumHandler = (event) => {
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
        // Mark summary as stale if in personal context without any token (secure or plaintext)
        try {
          const needsTokenPersonal = effectiveMode === 'personal' && !cfg.hasSecurePat && !cfg.residualPlaintext;
          console.log('[webview.js][config] needsTokenPersonal=', needsTokenPersonal);
          if (needsTokenPersonal) {
            const summary = document.getElementById('summary');
            if (summary && !summary.classList.contains('summary-error')) {
              console.log('[webview.js][config] adding summary-error class');
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
          const plansData = cfg.generatedPlans && Array.isArray(cfg.generatedPlans.plans) ? cfg.generatedPlans : null;
          if (hasPlan && customIncluded) {
            let hint = document.getElementById('override-hint');
            const notes = document.getElementById('controls-notes');
            if (!hint) {
              hint = document.createElement('div');
              hint.id = 'override-hint';
              hint.className = 'notice-custom-override';
              const text = document.createElement('span');
              text.id = 'override-hint-text';
              text.textContent = 'Using custom Included value. Plan value is not applied.';
              const btn = document.createElement('button');
              btn.className = 'btn';
              btn.textContent = 'Use plan value';
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

        // Show a compact line stating the source of the Included limit (Plan vs Custom vs Billing) under right controls
        try {
          const customIncluded = Number(cfg.includedPremiumRequests || 0) > 0;
          const hasPlan = !!cfg.selectedPlanId;
          let src = document.getElementById('limit-source');
          if (!src) {
            src = document.createElement('div');
            src.id = 'limit-source';
            src.className = 'limit-source-text';
            const host = document.getElementById('right-meta') || document.querySelector('.controls');
            if (host) host.appendChild(src);
          }
          if (customIncluded) {
            src.textContent = 'Included limit: Custom value';
          } else if (hasPlan) {
            // Try to show plan name if available
            let planName = cfg.selectedPlanId;
            try {
              const plans = cfg.generatedPlans && Array.isArray(cfg.generatedPlans.plans) ? cfg.generatedPlans.plans : [];
              const found = plans.find(p => (p.id || p.name) === cfg.selectedPlanId);
              if (found && found.name) planName = found.name;
            } catch { /* noop */ }
            src.textContent = `Included limit: GitHub plan (${planName})`;
          } else {
            // Explicitly indicate billing-derived limit when no custom override or plan is selected
            src.textContent = 'Included limit: Billing data';
          }
        } catch { /* noop */ }
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
      el.className = 'metrics billing-micro';
      const includedLabel = b.userConfiguredIncluded ? 'Included (configured)' : 'Included';
      const priceLabel = b.userConfiguredPrice ? 'Price/request (configured)' : 'Price/request';
      const total = Number(b.totalQuantity || 0);
      const included = Number(b.totalIncludedQuantity || 0) || 0;
      const overage = Math.max(0, total - included);
      el.innerHTML = `
        <div class="micro-sparkline" role="img" aria-label="Usage sparkline" tabindex="0"></div>
        <div class="badges" role="group" aria-label="Usage summary">
          <span class="badge badge-primary" role="status" tabindex="0">${includedLabel}: ${included}</span>
          <span class="badge badge-used" role="status" tabindex="0">${localize ? (localize('cpum.webview.used', 'Used')) : 'Used'}: ${total}</span>
          <span class="badge badge-overage" role="status" tabindex="0">${localize ? (localize('cpum.webview.overage', 'Overage')) : 'Overage'}: ${overage}${overage > 0 ? ` ($${(overage * (b.pricePerPremiumRequest || 0.04)).toFixed(2)})` : ''}</span>
          <span class="badge badge-price" role="status" tabindex="0">${priceLabel}: $${(b.pricePerPremiumRequest || 0.04).toFixed(2)}</span>
        </div>
      `;
      const summary = document.querySelector('#summary');
      summary?.appendChild(el);
      // Draw a simple sparkline using recent items if provided, otherwise a tiny placeholder
      try {
        const spark = el.querySelector('.micro-sparkline');
        const points = (b.items && Array.isArray(b.items)) ? b.items.slice(-24).map(i => Number(i.quantity || 0)) : [];
        if (points.length && spark) {
          const max = Math.max(...points, 1);
          spark.innerHTML = '';
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
          spark.innerHTML = '<div class="spark-placeholder">—</div>';
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
  function renderUsageHistory(historyData) {
    console.log('[renderUsageHistory] called with:', historyData);
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

    // Render chart
    if (recentSnapshots && recentSnapshots.length > 1) {
      currentSnapshots = recentSnapshots; // Store for resize handling
      renderTrendChart(recentSnapshots);
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

    console.log('Chart colors:', { chartLineColor, chartAxisColor, chartTextColor }); // Debug

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
    console.log('Chart margins:', margin); // Debug: verify margin values
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
    ctx.fillText(minQuantity.toString(), margin.left - 10, displayHeight - margin.bottom);
    ctx.fillText(maxQuantity.toString(), margin.left - 10, margin.top + 5);
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

  vscode?.postMessage({ type: 'getConfig' });
})();
