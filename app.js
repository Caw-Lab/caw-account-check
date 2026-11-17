import { NETWORK_PRESETS, ZERO_ADDRESS } from './lib/contracts.js';
import { formatAllowance, formatUnits, shortAddr } from './lib/abi.js';
import { createRpcClient } from './lib/rpc.js';
import { formatI18n } from './lib/i18n.js';
import {
  inspectAccountSecurity,
  inspectMarketplace,
  inspectProfiles,
  inspectSessions,
  resolveTarget,
} from './lib/rescue.js';

const preset = NETWORK_PRESETS.testnet;
const LANG_KEY = 'caw-account-check:lang';

let lang = (() => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {}
  return (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja'))
    ? 'ja'
    : 'en';
})();

let lastSnapshot = null;

const form = document.getElementById('inspect-form');
const targetInput = document.getElementById('target-input');
const l1RpcInput = document.getElementById('l1-rpc');
const l2RpcInput = document.getElementById('l2-rpc');
const networkIdInput = document.getElementById('network-id');
const logBlocksSelect = document.getElementById('log-blocks');
const extraSessionKeysInput = document.getElementById('extra-session-keys');
const extraSpendersInput = document.getElementById('extra-spenders');
const inspectBtn = document.getElementById('inspect-btn');
const statusBar = document.getElementById('status-bar');
const errorBox = document.getElementById('error-box');
const resultsEl = document.getElementById('results');
const langSeg = document.getElementById('langseg');

const resolvedCard = document.getElementById('resolved-card');
const healthSummary = document.getElementById('health-summary');
const securitySection = document.getElementById('security-section');
const profilesSection = document.getElementById('profiles-section');
const sessionsSection = document.getElementById('sessions-section');
const marketplaceSection = document.getElementById('marketplace-section');
const transparencySection = document.getElementById('transparency-section');

l1RpcInput.value = preset.l1DefaultRpc;
l2RpcInput.value = preset.l2DefaultRpc;

function t(key, vars) {
  return formatI18n(lang, key, vars);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pill(cls, text) {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

function explorerAddrLink(explorerBase, addr) {
  if (!explorerBase || !addr) return `<span class="mono">${esc(addr)}</span>`;
  const url = `${explorerBase.replace(/\/$/, '')}/address/${encodeURIComponent(addr)}`;
  return `<a class="mono" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(addr)} ↗</a>`;
}

function fmtTimestamp(sec) {
  if (!sec) return '-';
  const d = new Date(sec * 1000);
  return d.toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US');
}

function parseAddrList(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function summarizeHealth(sec, profiles, sessData, mp, lookbackBlocks) {
  const cards = [];

  // 1. EIP-7702 delegation
  const d1 = sec.l1Delegation;
  const d2 = sec.l2Delegation;
  const anyDelegated = d1.delegated || d2.delegated;
  const anyUnknownOrContract =
    (d1.delegated && !d1.matchesOfficial && !d1.knownDelegator) ||
    (d2.delegated && !d2.matchesOfficial && !d2.knownDelegator) ||
    (!d1.delegated && !d1.isEoa) ||
    (!d2.delegated && !d2.isEoa);
  const knownNames = [...new Set([d1.knownDelegator?.shortLabel, d2.knownDelegator?.shortLabel].filter(Boolean))];
  if (!anyDelegated && d1.isEoa && d2.isEoa) {
    cards.push({ cls: 'ok', title: t('sum1_title'), status: t('sum1_eoa_st'), desc: t('sum1_eoa_desc') });
  } else if (anyDelegated && !anyUnknownOrContract && knownNames.length === 0) {
    cards.push({ cls: 'ok', title: t('sum1_title'), status: t('sum1_ok_st'), desc: t('sum1_ok_desc') });
  } else if (!anyUnknownOrContract && knownNames.length > 0) {
    cards.push({
      cls: 'info',
      title: t('sum1_title'),
      status: t('sum1_known_st', { name: knownNames.join(' / ') }),
      desc: t('sum1_known_desc'),
    });
  } else {
    cards.push({ cls: 'warn', title: t('sum1_title'), status: t('sum1_warn_st'), desc: t('sum1_warn_desc') });
  }

  // 2. Allowances
  const unlimitedCount = sec.allowances.filter(a => a.unlimited).length;
  const nonZeroCount = sec.allowances.filter(a => a.amount > 0n).length;
  if (nonZeroCount === 0) {
    cards.push({ cls: 'ok', title: t('sum2_title'), status: t('sum2_none_st'), desc: t('sum2_none_desc') });
  } else if (unlimitedCount > 0) {
    cards.push({ cls: 'warn', title: t('sum2_title'), status: t('sum2_unlim_st', { n: unlimitedCount }), desc: t('sum2_unlim_desc') });
  } else {
    cards.push({ cls: 'ok', title: t('sum2_title'), status: t('sum2_part_st', { n: nonZeroCount }), desc: t('sum2_part_desc') });
  }

  // 3. Profiles sync
  if (profiles.length === 0) {
    cards.push({ cls: 'ok', title: t('sum3_title'), status: t('sum3_empty_st'), desc: t('sum3_empty_desc') });
  } else {
    const unsynced = profiles.filter(p => !p.ownerSynced).length;
    const withdrawableCount = profiles.filter(p => p.withdrawable > 0n).length;
    if (unsynced === 0) {
      cards.push({
        cls: 'ok',
        title: t('sum3_title'),
        status: t('sum3_ok_st', { n: profiles.length }),
        desc: withdrawableCount > 0 ? t('sum3_ok_desc_w', { w: withdrawableCount }) : t('sum3_ok_desc'),
      });
    } else {
      cards.push({ cls: 'warn', title: t('sum3_title'), status: t('sum3_warn_st', { u: unsynced }), desc: t('sum3_warn_desc') });
    }
  }

  // 4. L2 Sessions
  const activeSessions = sessData.sessions.filter(s => s.status === 'active').length;
  if (lookbackBlocks === 0 || sessData.logError) {
    cards.push({
      cls: 'warn',
      title: t('sum4_title'),
      status: t('sum4_skip_st'),
      desc: sessData.logError ? t('sum4_skip_err') : t('sum4_skip_off'),
    });
  } else if (activeSessions === 0) {
    cards.push({ cls: 'ok', title: t('sum4_title'), status: t('sum4_ok_st'), desc: t('sum4_ok_desc', { b: lookbackBlocks.toLocaleString() }) });
  } else {
    cards.push({ cls: 'warn', title: t('sum4_title'), status: t('sum4_warn_st', { n: activeSessions }), desc: t('sum4_warn_desc') });
  }

  // 5. Marketplace funds
  const expiredOffers = mp.myActiveOffers.filter(o => o.expired).length;
  const hasFunds = mp.pendingEthPayout > 0n || mp.pendingCawPayout > 0n || mp.refundableBids.length > 0 || expiredOffers > 0;
  if (hasFunds) {
    const parts = [];
    if (mp.pendingEthPayout > 0n || mp.pendingCawPayout > 0n) parts.push(t('part_payout'));
    if (mp.refundableBids.length > 0) parts.push(t('part_bids', { n: mp.refundableBids.length }));
    if (expiredOffers > 0) parts.push(t('part_offers', { n: expiredOffers }));
    cards.push({
      cls: 'warn',
      title: t('sum5_title'),
      status: t('sum5_warn_st', { parts: parts.join(' / ') }),
      desc: t('sum5_warn_desc'),
    });
  } else {
    cards.push({ cls: 'ok', title: t('sum5_title'), status: t('sum5_ok_st'), desc: t('sum5_ok_desc') });
  }

  return cards;
}

function renderHealthSummary(cards) {
  healthSummary.innerHTML = `<div class="sum-grid">${cards.map(c => `
    <div class="sum-card ${esc(c.cls)}">
      <div class="sum-title">${esc(c.title)}</div>
      <div class="sum-status">${esc(c.status)}</div>
      <div class="sum-desc">${esc(c.desc)}</div>
    </div>
  `).join('')}</div>`;
}

function renderDelegationBox(chainLabel, explorerBase, d) {
  let badge = pill('ok', t('del_eoa'));
  let meaning = esc(t('del_eoa_desc'));
  let delegateRow = '';
  if (d.delegated) {
    const linkHtml = explorerAddrLink(explorerBase, d.delegate);
    if (d.matchesOfficial) {
      badge = pill('ok', t('del_off'));
      meaning = esc(t('del_off_desc'));
    } else if (d.knownDelegator) {
      badge = pill('info', t('del_known', { name: d.knownDelegator.shortLabel }));
      meaning = esc(t('del_known_desc', { fullName: d.knownDelegator.label }));
    } else {
      badge = pill('warn', t('del_other'));
      meaning = esc(t('del_other_desc'));
    }
    delegateRow = `<div class="del-addr-row"><span class="del-addr-lbl">delegate</span>${linkHtml}</div>`;
    if (d.managementNonce !== null || d.executeNonce !== null) {
      meaning += `<br>${esc(t('del_nonces', { m: d.managementNonce ?? '-', e: d.executeNonce ?? '-' }))}`;
    }
  } else if (!d.isEoa) {
    badge = pill('warn', t('del_contract', { b: d.codeBytes }));
    meaning = esc(t('del_contract_desc'));
  }

  let eventsHtml = '';
  if (d.eventSummary) {
    const activeCount = d.eventSummary.passkeys.filter(p => p.status === 'active').length;
    const pendingCount = d.eventSummary.passkeys.filter(p => p.status === 'pending').length;
    let txt = t('del_passkeys', { a: activeCount, p: pendingCount });
    if (d.eventSummary.lastFallback) txt += t('del_fallback', { f: shortAddr(d.eventSummary.lastFallback) });
    if (d.logTruncated) txt += t('del_trunc');
    eventsHtml = `<div class="note-line">${esc(txt)}</div>`;
  } else if (d.logError) {
    eventsHtml = `<div class="note-line">${esc(t('del_log_err') + d.logError)}</div>`;
  }

  return `
    <div class="kv-box">
      <div class="kv-k">${esc(chainLabel)} (block #${d.blockNumber.toLocaleString()})</div>
      <div class="kv-v">${badge}</div>
      <div class="note-line">${meaning}</div>
      ${delegateRow}
      ${eventsHtml}
    </div>
  `;
}

function renderResolved(target, l1Block, l2Block, networkId) {
  let viaText = t('via_address');
  if (target.resolvedVia === 'username') viaText = t('via_username', { u: target.username });
  if (target.resolvedVia === 'tokenId') viaText = t('via_tokenId', { id: target.tokenId });

  resolvedCard.innerHTML = `
    <div class="kv-grid kv-resolved">
      <div class="kv-box">
        <div class="kv-k">${esc(t('res_owner'))}</div>
        <div class="kv-v mono addr-full">${esc(target.address)}</div>
        <div class="note-line">${esc(t('res_via') + viaText)}</div>
      </div>
      <div class="kv-box">
        <div class="kv-k">L1 (${esc(preset.l1ChainName)})</div>
        <div class="kv-v">Block #${l1Block.toLocaleString()}</div>
        <div class="note-line">${esc(t('res_l1_desc'))}</div>
      </div>
      <div class="kv-box">
        <div class="kv-k">L2 (${esc(preset.l2ChainName)})</div>
        <div class="kv-v">Block #${l2Block.toLocaleString()}</div>
        <div class="note-line">${esc(t('res_l2_desc', { nid: networkId }))}</div>
      </div>
    </div>
  `;
}

function renderSecurity(sec) {
  const { decimals, symbol, walletBalance } = sec.caw;
  const rows = sec.allowances.map(a => {
    const fmt = formatAllowance(a.amount, decimals);
    const label = fmt.unlimited
      ? t('allow_unlim')
      : a.amount === 0n
        ? t('allow_zero')
        : `${formatUnits(a.amount, decimals)} ${symbol}`;
    const sub = fmt.unlimited ? t('allow_unlim_sub') : null;
    const badge = fmt.unlimited
      ? pill('warn', label)
      : a.amount > 0n
        ? pill('', label)
        : pill('ok', label);
    const meaning = a.label === 'Custom Spender'
      ? (a.amount > 0n ? t('mean_custom_pos') : t('mean_custom_zero'))
      : fmt.unlimited
        ? t('mean_off_unlim')
        : a.amount > 0n
          ? t('mean_off_pos')
          : t('mean_off_zero');
    return `
      <tr>
        <td>${esc(a.label)}</td>
        <td class="mono">${esc(a.address)}</td>
        <td class="nowrap">${badge}${sub ? `<span class="hint-sub">${esc(sub)}</span>` : ''}</td>
        <td>${esc(meaning)}</td>
      </tr>
    `;
  }).join('');

  securitySection.innerHTML = `
    <div class="sec-guide">${esc(t('sec_guide', { sym: symbol }))}</div>
    <div class="kv-grid">
      ${renderDelegationBox(t('l1_del_lbl'), preset.l1Explorer, sec.l1Delegation)}
      ${renderDelegationBox(t('l2_del_lbl'), preset.l2Explorer, sec.l2Delegation)}
      <div class="kv-box">
        <div class="kv-k">${esc(t('l1_caw_bal', { sym: symbol }))}</div>
        <div class="kv-v">${esc(formatUnits(walletBalance, decimals))} ${esc(symbol)}</div>
        <div class="note-line">${esc(t('l1_caw_desc'))}</div>
      </div>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr><th>${esc(t('th_spender'))}</th><th>${esc(t('th_contract'))}</th><th>${esc(t('th_allowance'))}</th><th>${esc(t('th_meaning'))}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderProfiles(profiles, decimals, symbol) {
  if (profiles.length === 0) {
    profilesSection.innerHTML = `
      <div class="sec-guide">${esc(t('prof_guide_empty'))}</div>
      <p class="empty">${esc(t('prof_empty'))}</p>
    `;
    return;
  }
  const rows = profiles.map(p => {
    const syncBadge = p.ownerSynced
      ? pill('ok', t('sync_ok'))
      : pill('warn', t('sync_warn', { addr: p.l2Owner ? shortAddr(p.l2Owner) : t('unreflected') }));
    const authBadge = p.authenticated ? pill('ok', t('auth_ok')) : pill('', t('auth_no'));
    const feeLock = p.withdrawFeeLocked
      ? pill('warn', t('lock_on', { amt: formatUnits(p.lockedWithdrawFee, decimals), sym: symbol }))
      : pill('ok', t('lock_off'));
    return `
      <tr>
        <td class="prof-cell"><span class="prof-id">#${p.tokenId}</span><b>@${esc(p.username)}</b></td>
        <td>${authBadge}</td>
        <td>${syncBadge}</td>
        <td><span class="val-main">${esc(formatUnits(p.l2Balance, decimals))} ${esc(symbol)}</span><span class="hint-sub">${esc(t('l2_bal_sub'))}</span></td>
        <td><span class="val-main">${esc(formatUnits(p.withdrawable, decimals))} ${esc(symbol)}</span><span class="hint-sub">${esc(p.withdrawable > 0n ? t('w_avail') : t('w_none'))}</span></td>
        <td>${feeLock}</td>
        <td class="nowrap">${p.sponsorRepay > 0n ? `${esc(formatUnits(p.sponsorRepay, decimals))} ${esc(symbol)}` : esc(t('repay_none'))}</td>
      </tr>
    `;
  }).join('');

  profilesSection.innerHTML = `
    <div class="sec-guide">${esc(t('prof_guide'))}</div>
    <div class="tbl-wrap">
      <table class="tbl-profiles">
        <thead>
          <tr>
            <th>${esc(t('th_prof'))}</th>
            <th>${esc(t('th_auth'))}<span class="hint-sub">${esc(t('th_auth_sub'))}</span></th>
            <th>${esc(t('th_sync'))}<span class="hint-sub">${esc(t('th_sync_sub'))}</span></th>
            <th>${esc(t('th_l2bal'))}<span class="hint-sub">${esc(t('th_l2bal_sub'))}</span></th>
            <th>${esc(t('th_wdraw'))}<span class="hint-sub">${esc(t('th_wdraw_sub'))}</span></th>
            <th>${esc(t('th_lock'))}<span class="hint-sub">${esc(t('th_lock_sub'))}</span></th>
            <th>${esc(t('th_repay'))}<span class="hint-sub">${esc(t('th_repay_sub'))}</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSessions(sessData, _decimals, symbol) {
  const header = `
    <div class="sec-guide">
      ${esc(t('sess_guide'))}<br>
      ${esc(t('sess_counter_note', { ep: sessData.ownerSessionEpoch, nc: sessData.sessionNonce }))}${sessData.logTruncated ? `<br><b>${esc(t('sess_trunc'))}</b>` : ''}
    </div>
  `;
  const logErr = sessData.logError
    ? `<div class="error-box">${esc(t('sess_log_err', { err: sessData.logError }))}</div>`
    : '';

  if (sessData.sessions.length === 0) {
    sessionsSection.innerHTML = `${header}${logErr}<p class="empty">${esc(t('sess_empty'))}</p>`;
    return;
  }

  const statusMeta = s => {
    if (s === 'active') return { badge: pill('ok', t('st_active')), note: t('st_active_note') };
    if (s === 'expired') return { badge: pill('warn', t('st_expired')), note: t('st_expired_note') };
    if (s === 'revoked') return { badge: pill('', t('st_revoked')), note: t('st_revoked_note') };
    if (s === 'invalidated') return { badge: pill('', t('st_invalid')), note: t('st_invalid_note') };
    return { badge: pill('', t('st_unreg')), note: t('st_unreg_note') };
  };

  const rows = sessData.sessions.map(s => {
    const scope = s.scopes.length ? s.scopes.join(', ') : '-';
    const profileScope = s.profileId === 0 ? t('scope_all') : t('scope_one', { id: s.profileId });
    const spentStr = `${s.spent.toLocaleString()} / ${s.spendLimit === 0n ? t('limit_unlim') : s.spendLimit.toLocaleString()} ${symbol}`;
    const meta = statusMeta(s.status);
    return `
      <tr>
        <td>${meta.badge}<span class="hint-sub">${esc(meta.note)}</span></td>
        <td class="mono">${esc(s.sessionKey)}</td>
        <td>${esc(fmtTimestamp(s.expiry))}</td>
        <td>${esc(profileScope)}</td>
        <td>${esc(scope)}</td>
        <td>${esc(spentStr)}</td>
      </tr>
    `;
  }).join('');

  sessionsSection.innerHTML = `
    ${header}${logErr}
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>${esc(t('th_s_state'))}</th>
            <th>${esc(t('th_s_key'))}</th>
            <th>${esc(t('th_s_exp'))}</th>
            <th>${esc(t('th_s_scope'))}</th>
            <th>${esc(t('th_s_acts'))}</th>
            <th>${esc(t('th_s_spent'))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function fmtPaymentAmount(amount, paymentToken, cawDecimals, cawSymbol) {
  if (paymentToken === ZERO_ADDRESS) {
    return `${formatUnits(amount, 18)} ETH`;
  }
  if (paymentToken.toLowerCase() === preset.contracts.L1.MintableCaw.toLowerCase()) {
    return `${formatUnits(amount, cawDecimals)} ${cawSymbol}`;
  }
  return `${formatUnits(amount, 18)} (${shortAddr(paymentToken)})`;
}

function renderMarketplace(mp, decimals, symbol) {
  const offersRows = mp.myActiveOffers.map(o => `
    <tr>
      <td>#${o.offerId}</td>
      <td>#${o.tokenId}</td>
      <td>${esc(fmtPaymentAmount(o.amount, o.paymentToken, decimals, symbol))}</td>
      <td>${esc(fmtTimestamp(o.expiry))}</td>
      <td>${o.expired ? pill('warn', t('offer_exp')) : pill('ok', t('offer_act'))}</td>
    </tr>
  `).join('');

  const bidRows = mp.refundableBids.map(b => `
    <tr>
      <td>#${b.listingId}</td>
      <td>#${b.tokenId}</td>
      <td>${esc(formatUnits(b.pendingReturn, 18))} ETH</td>
      <td>${b.active ? pill('warn', t('bid_act')) : pill('warn', t('bid_end'))}</td>
    </tr>
  `).join('');

  const listingRows = mp.myActiveListings.map(l => `
    <tr>
      <td>#${l.listingId}</td>
      <td>#${l.tokenId}</td>
      <td>${esc(l.listingType)}</td>
      <td>${esc(fmtPaymentAmount(l.startPrice, l.paymentToken, decimals, symbol))}</td>
      <td>${l.highestBid > 0n ? esc(fmtPaymentAmount(l.highestBid, l.paymentToken, decimals, symbol)) : '-'}</td>
    </tr>
  `).join('');

  marketplaceSection.innerHTML = `
    <div class="sec-guide">${esc(t('mp_guide'))}</div>
    <div class="kv-grid">
      <div class="kv-box">
        <div class="kv-k">${esc(t('mp_eth_pay'))}</div>
        <div class="kv-v">${mp.pendingEthPayout > 0n ? pill('warn', `${formatUnits(mp.pendingEthPayout, 18)} ETH ${t('mp_claimable')}`) : `${esc(formatUnits(mp.pendingEthPayout, 18))} ETH`}</div>
      </div>
      <div class="kv-box">
        <div class="kv-k">${esc(t('mp_caw_pay', { sym: symbol }))}</div>
        <div class="kv-v">${mp.pendingCawPayout > 0n ? pill('warn', `${formatUnits(mp.pendingCawPayout, decimals)} ${symbol} ${t('mp_claimable')}`) : `${esc(formatUnits(mp.pendingCawPayout, decimals))} ${esc(symbol)}`}</div>
      </div>
      <div class="kv-box">
        <div class="kv-k">${esc(t('mp_total'))}</div>
        <div class="kv-v">Offers: ${Math.max(0, mp.nextOfferId - 1)} / Listings: ${Math.max(0, mp.nextListingId - 1)}</div>
      </div>
    </div>
    ${offersRows ? `
      <h3>${esc(t('mp_h_offers'))}</h3>
      <div class="tbl-wrap"><table><thead><tr><th>${esc(t('th_oid'))}</th><th>${esc(t('th_tok'))}</th><th>${esc(t('th_dep'))}</th><th>${esc(t('th_exp'))}</th><th>${esc(t('th_st'))}</th></tr></thead><tbody>${offersRows}</tbody></table></div>
    ` : `<p class="empty">${esc(t('mp_no_offers'))}</p>`}
    ${bidRows ? `
      <h3>${esc(t('mp_h_bids'))}</h3>
      <div class="tbl-wrap"><table><thead><tr><th>${esc(t('th_lid'))}</th><th>${esc(t('th_tok'))}</th><th>${esc(t('th_ref'))}</th><th>${esc(t('th_st'))}</th></tr></thead><tbody>${bidRows}</tbody></table></div>
    ` : `<p class="empty">${esc(t('mp_no_bids'))}</p>`}
    ${listingRows ? `
      <h3>${esc(t('mp_h_listings'))}</h3>
      <div class="tbl-wrap"><table><thead><tr><th>${esc(t('th_lid'))}</th><th>${esc(t('th_tok'))}</th><th>${esc(t('th_ltype'))}</th><th>${esc(t('th_startp'))}</th><th>${esc(t('th_hbid'))}</th></tr></thead><tbody>${listingRows}</tbody></table></div>
    ` : ''}
  `;
}

function renderTransparency(l1Url, l2Url) {
  const rows = [
    ['L1 RPC', l1Url],
    ['L2 RPC', l2Url],
    ['L1 MintableCaw', preset.contracts.L1.MintableCaw],
    ['L1 CawProfile', preset.contracts.L1.CawProfile],
    ['L1 CawProfileLens', preset.contracts.L1.CawProfileLens],
    ['L1 CawProfileMinter', preset.contracts.L1.CawProfileMinter],
    ['L1 CawProfileMarketplace', preset.contracts.L1.CawProfileMarketplace],
    ['L1/L2 SmartEOA', preset.contracts.L1.SmartEOA],
    ['L2 CawProfileLedger', preset.contracts.L2.CawProfileLedger],
    ['L2 CawActions', preset.contracts.L2.CawActions],
  ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('');

  transparencySection.innerHTML = `<div class="tbl-wrap"><table><tbody>${rows}</tbody></table></div>`;
}

function renderAllSnapshot() {
  if (!lastSnapshot) return;
  const { target, security, profiles, sessions, marketplace, l2Block, networkId, lookbackBlocks, l1Url, l2Url } = lastSnapshot;
  const summaryCards = summarizeHealth(security, profiles, sessions, marketplace, lookbackBlocks);
  renderResolved(target, security.l1Delegation.blockNumber, l2Block, networkId);
  renderHealthSummary(summaryCards);
  renderSecurity(security);
  renderProfiles(profiles, security.caw.decimals, security.caw.symbol);
  renderSessions(sessions, security.caw.decimals, security.caw.symbol);
  renderMarketplace(marketplace, security.caw.decimals, security.caw.symbol);
  renderTransparency(l1Url, l2Url);
}

function applyLang() {
  document.documentElement.lang = lang;
  for (const btn of langSeg.querySelectorAll('button[data-lang]')) {
    btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
  }
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  }
  renderAllSnapshot();
}

langSeg.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-lang]');
  if (!btn) return;
  const next = btn.dataset.lang;
  if (next !== 'ja' && next !== 'en') return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  applyLang();
});

applyLang();

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  errorBox.hidden = true;
  resultsEl.hidden = true;
  statusBar.hidden = false;
  statusBar.textContent = t('status_querying');
  inspectBtn.disabled = true;

  try {
    const l1Url = l1RpcInput.value.trim();
    const l2Url = l2RpcInput.value.trim();
    const networkId = Number(networkIdInput.value) || 1;
    const lookbackBlocks = Number(logBlocksSelect.value) || 0;
    const extraSessionKeys = parseAddrList(extraSessionKeysInput.value);
    const extraSpenders = parseAddrList(extraSpendersInput.value);

    const l1Rpc = createRpcClient(l1Url, { expectedChainId: preset.l1ChainId });
    const l2Rpc = createRpcClient(l2Url, { expectedChainId: preset.l2ChainId });

    const target = await resolveTarget(l1Rpc, targetInput.value, preset.contracts.L1);
    statusBar.textContent = t('status_fetching', { addr: target.address });

    const [security, profiles, l2Block, marketplace] = await Promise.all([
      inspectAccountSecurity(l1Rpc, l2Rpc, target.address, preset.contracts, {
        lookbackBlocks,
        extraSpenders,
      }),
      inspectProfiles(l1Rpc, l2Rpc, target.address, networkId, preset.contracts),
      l2Rpc.getBlockNumber(),
      inspectMarketplace(l1Rpc, target.address, preset.contracts),
    ]);

    const sessions = await inspectSessions(l2Rpc, target.address, l2Block, preset.contracts, {
      lookbackBlocks,
      extraSessionKeys,
    });

    lastSnapshot = {
      target,
      security,
      profiles,
      sessions,
      marketplace,
      l2Block,
      networkId,
      lookbackBlocks,
      l1Url,
      l2Url,
    };

    renderAllSnapshot();

    statusBar.hidden = true;
    resultsEl.hidden = false;
  } catch (err) {
    statusBar.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = t('err_prefix') + (err?.message || String(err));
  } finally {
    inspectBtn.disabled = false;
  }
});
