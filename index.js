import { extension_settings, loadExtensionSettings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const extensionName = 'ST-CopilotUsage';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = { github_token: '' };
const GH_API = 'https://api.github.com';

let refreshTimer = null;

/* ── helpers ──────────────────────────────────────────── */

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    $('#copilot_github_token').val(extension_settings[extensionName].github_token || '');
}

async function ghFetch(path, token, timeout = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const resp = await fetch(`${GH_API}${path}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/json',
            },
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        clearTimeout(timer);
        return null;
    }
}

/* ── main check ──────────────────────────────────────── */

async function checkUsage() {
    const token = extension_settings[extensionName]?.github_token;
    if (!token) { showStatus('請輸入 GitHub Token', 'error'); return; }

    showStatus('查詢中…', 'loading');

    // 1. Validate token
    const user = await ghFetch('/user', token);
    if (!user) { showStatus('Token 無效或網路錯誤', 'error'); return; }

    // 2. Get copilot user info (quota_snapshots lives here)
    const cpUser = await ghFetch('/copilot_internal/user', token);
    if (!cpUser) { showStatus('無法取得 Copilot 資訊（可能沒有 Copilot 訂閱）', 'error'); return; }

    const snap = cpUser.quota_snapshots?.premium_interactions;
    if (!snap) { showStatus('此帳戶無 premium request 配額資訊', 'error'); return; }

    const limit = snap.entitlement;
    const remaining = snap.remaining;
    const used = limit - remaining;
    const resetDate = cpUser.quota_reset_date || cpUser.quota_reset_date_utc || '';

    // Plan label
    const skuLabels = {
        'copilot_for_business':     'Copilot Business',
        'copilot_enterprise':       'Copilot Enterprise',
        'monthly_subscriber_quota': 'Copilot Pro',
        'copilot_pro_plus':         'Copilot Pro+',
        'copilot_free':             'Copilot Free',
    };
    const sku = cpUser.access_type_sku || '';
    const planLabel = skuLabels[sku] || sku || 'Copilot';

    updateDisplay(used, limit, planLabel, resetDate);
}

/* ── UI helpers ───────────────────────────────────────── */

function updateDisplay(used, limit, planLabel, resetDate) {
    $('#copilot_usage_display').show();
    $('#copilot_status_message').hide();
    $('#copilot_plan_label').text(planLabel);

    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    $('#copilot_usage_summary').text(`${pct}%｜${used} / ${limit}`);
    $('#copilot_progress_bar')
        .css('width', `${Math.max(pct, 2)}%`)
        .attr('class', 'copilot-progress-bar' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : ''));

    if (resetDate) {
        const dateStr = resetDate.split('T')[0]; // "2026-04-01"
        $('#copilot_reset_date').text(`重置日期: ${dateStr}`).show();
    } else {
        $('#copilot_reset_date').hide();
    }
}

function showStatus(msg, type) {
    $('#copilot_usage_display').hide();
    $('#copilot_status_message').show().attr('class', `copilot-usage_block copilot-status ${type}`);
    $('#copilot_status_text').text(msg);
}

/* ── init ─────────────────────────────────────────────── */

jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings').append(settingsHtml);
    await loadSettings();

    // Token input & save
    $('#copilot_github_token').on('input', function () {
        extension_settings[extensionName].github_token = $(this).val().trim();
        saveSettingsDebounced();
    });

    // Toggle visibility
    let vis = false;
    $('#copilot_toggle_token_visibility').on('click', function () {
        vis = !vis;
        $('#copilot_github_token').attr('type', vis ? 'text' : 'password');
        $(this).toggleClass('fa-eye fa-eye-slash');
    });

    // On token change → check
    $('#copilot_github_token').on('change', function () {
        if ($(this).val().trim()) checkUsage();
    });

    // Manual refresh button
    $(document).on('click', '#copilot_refresh_btn', () => {
        if (extension_settings[extensionName]?.github_token) checkUsage();
    });

    // Initial check
    if (extension_settings[extensionName]?.github_token) {
        setTimeout(checkUsage, 2000);
    }

    // Auto-refresh every 5 min
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (extension_settings[extensionName]?.github_token) checkUsage();
    }, 5 * 60 * 1000);
});
