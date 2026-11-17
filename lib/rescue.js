// Read-only rescue inspection logic built strictly over L1 & L2 JSON-RPC calls.

import {
  findKnownDelegator,
  MAX_UINT256,
  SELECTORS,
  TOPICS,
  ZERO_ADDRESS,
} from './contracts.js';
import {
  decodeLensToken,
  decodeListing,
  decodeOffer,
  decodeProfilesWithNetworkState,
  decodeScopeBitmap,
  decodeSingleAddress,
  decodeSingleString,
  decodeSingleUint,
  decodeStoredSession,
  encodeAddressAddressCall,
  encodeAddressArgCall,
  encodeAddressUintCall,
  encodeStringArgCall,
  encodeUintArgCall,
  isValidAddress,
  normalizeAddress,
  padAddress,
  parseEip7702Code,
  strip0x,
} from './abi.js';

export async function resolveTarget(l1Rpc, rawInput, contractsL1) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) {
    throw new Error('ウォレットアドレス、@username、または tokenId を入力してください');
  }

  if (isValidAddress(trimmed)) {
    return {
      address: normalizeAddress(trimmed),
      resolvedVia: 'address',
      tokenId: null,
      username: null,
    };
  }

  const tokenMatch = trimmed.match(/^#?(\d+)$/);
  if (tokenMatch) {
    const tokenId = Number(tokenMatch[1]);
    if (!Number.isInteger(tokenId) || tokenId <= 0) {
      throw new Error('tokenId は 1 以上の整数を指定してください');
    }
    const res = await l1Rpc.ethCall(
      contractsL1.CawProfile,
      encodeUintArgCall(SELECTORS.ownerOf, tokenId),
    );
    const owner = decodeSingleAddress(res);
    if (!owner || owner === ZERO_ADDRESS) {
      throw new Error(`tokenId #${tokenId} のオーナーが見つかりませんでした`);
    }
    return {
      address: owner,
      resolvedVia: 'tokenId',
      tokenId,
      username: null,
    };
  }

  const username = trimmed.replace(/^@/, '').toLowerCase();
  const res = await l1Rpc.ethCall(
    contractsL1.CawProfileLens,
    encodeStringArgCall(SELECTORS.tokenByUsername, username),
  );
  const token = decodeLensToken(res);
  if (!token.tokenId || token.owner === ZERO_ADDRESS) {
    throw new Error(`@${username} に該当するプロフィールが L1 で見つかりませんでした`);
  }
  return {
    address: token.owner,
    resolvedVia: 'username',
    tokenId: token.tokenId,
    username: token.username || username,
  };
}

function summarizeSmartEoaLogs(logs) {
  const passkeys = new Map(); // pubkeyHash -> { status, validFrom, blockNumber }
  let lastFallback = null;

  for (const log of logs) {
    const topic0 = (log.topics?.[0] || '').toLowerCase();
    const blockNumber = Number(BigInt(log.blockNumber || '0x0'));
    if (topic0 === TOPICS.PasskeyAdded) {
      const hash = (log.topics?.[1] || '').toLowerCase();
      const validFrom = log.data && log.data !== '0x' ? Number(BigInt(log.data)) : 0;
      passkeys.set(hash, { status: 'pending', validFrom, blockNumber });
    } else if (topic0 === TOPICS.PasskeyActivated) {
      const hash = (log.topics?.[1] || '').toLowerCase();
      const prev = passkeys.get(hash) || {};
      passkeys.set(hash, { ...prev, status: 'active', validFrom: 0, blockNumber });
    } else if (topic0 === TOPICS.PasskeyRemoved) {
      const hash = (log.topics?.[1] || '').toLowerCase();
      passkeys.set(hash, { status: 'removed', validFrom: 0, blockNumber });
    } else if (topic0 === TOPICS.PasskeyCancelled) {
      const hash = (log.topics?.[1] || '').toLowerCase();
      passkeys.set(hash, { status: 'cancelled', validFrom: 0, blockNumber });
    } else if (topic0 === TOPICS.EcdsaFallbackRotated) {
      const t1 = log.topics?.[1];
      if (t1 && t1.length >= 42) {
        lastFallback = '0x' + t1.slice(-40).toLowerCase();
      }
    }
  }

  return {
    passkeys: Array.from(passkeys.entries()).map(([hash, info]) => ({ hash, ...info })),
    lastFallback,
  };
}

async function inspectChainDelegation(rpc, address, expectedSmartEoa, lookbackBlocks) {
  const [blockNumber, codeHex] = await Promise.all([
    rpc.getBlockNumber(),
    rpc.getCode(address),
  ]);
  const parsed = parseEip7702Code(codeHex);
  const expected = normalizeAddress(expectedSmartEoa);
  const matchesOfficial = parsed.delegated && parsed.delegate === expected;
  const knownDelegator = parsed.delegated && !matchesOfficial ? findKnownDelegator(parsed.delegate) : null;

  let managementNonce = null;
  let executeNonce = null;
  let eventSummary = null;
  let logError = null;
  let logTruncated = false;

  // SmartEOA nonces and Passkey logs only apply when delegated to CAW's SmartEOA contract.
  if (matchesOfficial) {
    const [mRes, eRes] = await Promise.all([
      rpc.ethCall(address, SELECTORS.managementNonceOf).catch(() => null),
      rpc.ethCall(address, SELECTORS.executeNonceOf).catch(() => null),
    ]);
    if (mRes && strip0x(mRes).length >= 64) managementNonce = Number(decodeSingleUint(mRes));
    if (eRes && strip0x(eRes).length >= 64) executeNonce = Number(decodeSingleUint(eRes));

    if (lookbackBlocks > 0) {
      try {
        const res = await rpc.getLogsChunked({
          address,
          topics: [[
            TOPICS.PasskeyAdded,
            TOPICS.PasskeyActivated,
            TOPICS.PasskeyRemoved,
            TOPICS.PasskeyCancelled,
            TOPICS.EcdsaFallbackRotated,
          ]],
          fromBlock: Math.max(0, blockNumber - lookbackBlocks),
          toBlock: blockNumber,
        });
        eventSummary = summarizeSmartEoaLogs(res.logs);
        logTruncated = res.truncated;
      } catch (err) {
        logError = err?.message || String(err);
      }
    }
  }

  return {
    blockNumber,
    ...parsed,
    expectedSmartEoa: expected,
    matchesOfficial,
    knownDelegator,
    managementNonce,
    executeNonce,
    eventSummary,
    logError,
    logTruncated,
  };
}

export async function inspectAccountSecurity(l1Rpc, l2Rpc, owner, contracts, { lookbackBlocks = 50_000, extraSpenders = [] } = {}) {
  const [l1Delegation, l2Delegation, cawBalanceHex, decimalsHex, symbolHex] = await Promise.all([
    inspectChainDelegation(l1Rpc, owner, contracts.L1.SmartEOA, lookbackBlocks),
    inspectChainDelegation(l2Rpc, owner, contracts.L2.SmartEOA, lookbackBlocks),
    l1Rpc.ethCall(contracts.L1.MintableCaw, encodeAddressArgCall(SELECTORS.balanceOf, owner)),
    l1Rpc.ethCall(contracts.L1.MintableCaw, SELECTORS.decimals).catch(() => '0x12'),
    l1Rpc.ethCall(contracts.L1.MintableCaw, SELECTORS.symbol).catch(() => ''),
  ]);

  const spenders = [
    { label: 'CawProfileMinter', address: normalizeAddress(contracts.L1.CawProfileMinter) },
    { label: 'CawProfile', address: normalizeAddress(contracts.L1.CawProfile) },
    { label: 'CawProfileMarketplace', address: normalizeAddress(contracts.L1.CawProfileMarketplace) },
  ];
  for (const s of extraSpenders) {
    if (isValidAddress(s)) {
      const norm = normalizeAddress(s);
      if (!spenders.some(x => x.address === norm)) {
        spenders.push({ label: 'Custom Spender', address: norm });
      }
    }
  }

  const allowances = await Promise.all(
    spenders.map(async s => {
      const hex = await l1Rpc.ethCall(
        contracts.L1.MintableCaw,
        encodeAddressAddressCall(SELECTORS.allowance, owner, s.address),
      );
      const amount = decodeSingleUint(hex);
      return {
        ...s,
        amount,
        unlimited: amount >= MAX_UINT256 / 2n,
      };
    }),
  );

  return {
    l1Delegation,
    l2Delegation,
    caw: {
      address: normalizeAddress(contracts.L1.MintableCaw),
      symbol: decodeSingleString(symbolHex) || 'CAW',
      decimals: Number(decodeSingleUint(decimalsHex) || 18n),
      walletBalance: decodeSingleUint(cawBalanceHex),
    },
    allowances,
  };
}

export async function inspectProfiles(l1Rpc, l2Rpc, owner, networkId, contracts) {
  const hex = await l1Rpc.ethCall(
    contracts.L1.CawProfileLens,
    encodeAddressUintCall(SELECTORS.profilesWithNetworkState, owner, networkId),
  );
  const profiles = decodeProfilesWithNetworkState(hex);

  const enriched = await Promise.all(
    profiles.map(async p => {
      const [l2BalHex, l2OwnerHex, sponsorRepayHex] = await Promise.all([
        l2Rpc.ethCall(contracts.L2.CawProfileLedger, encodeUintArgCall(SELECTORS.cawBalanceOf, p.tokenId)),
        l2Rpc.ethCall(contracts.L2.CawProfileLedger, encodeUintArgCall(SELECTORS.ownerOf, p.tokenId)).catch(() => null),
        l2Rpc.ethCall(contracts.L2.CawProfileLedger, encodeUintArgCall(SELECTORS.sponsorRepay, p.tokenId)).catch(() => '0x0'),
      ]);
      const l2Owner = l2OwnerHex ? decodeSingleAddress(l2OwnerHex) : null;
      return {
        ...p,
        l2Balance: decodeSingleUint(l2BalHex),
        l2Owner,
        ownerSynced: l2Owner !== null && l2Owner === p.owner,
        sponsorRepay: decodeSingleUint(sponsorRepayHex),
      };
    }),
  );

  return enriched;
}

export async function inspectSessions(l2Rpc, owner, l2BlockNumber, contracts, { lookbackBlocks = 100_000, extraSessionKeys = [], nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const [epochHex, nonceHex] = await Promise.all([
    l2Rpc.ethCall(contracts.L2.CawProfileLedger, encodeAddressArgCall(SELECTORS.ownerSessionEpoch, owner)),
    l2Rpc.ethCall(contracts.L2.CawProfileLedger, encodeAddressArgCall(SELECTORS.sessionNonce, owner)),
  ]);

  const ownerTopic = '0x' + padAddress(owner);
  const historyMap = new Map(); // sessionKey -> { createdAtBlock, revokedAtBlock }
  let logError = null;
  let logTruncated = false;

  if (lookbackBlocks > 0) {
    try {
      const res = await l2Rpc.getLogsChunked({
        address: contracts.L2.CawProfileLedger,
        topics: [[TOPICS.SessionCreated, TOPICS.SessionRevoked], ownerTopic],
        fromBlock: Math.max(0, l2BlockNumber - lookbackBlocks),
        toBlock: l2BlockNumber,
      });
      logTruncated = res.truncated;
      for (const log of res.logs) {
        const t0 = (log.topics?.[0] || '').toLowerCase();
        const t2 = log.topics?.[2];
        if (!t2 || t2.length < 42) continue;
        const key = '0x' + t2.slice(-40).toLowerCase();
        const block = Number(BigInt(log.blockNumber || '0x0'));
        const cur = historyMap.get(key) || { createdAtBlock: null, revokedAtBlock: null };
        if (t0 === TOPICS.SessionCreated) cur.createdAtBlock = block;
        if (t0 === TOPICS.SessionRevoked) cur.revokedAtBlock = block;
        historyMap.set(key, cur);
      }
    } catch (err) {
      logError = err?.message || String(err);
    }
  }

  for (const rawKey of extraSessionKeys) {
    if (isValidAddress(rawKey)) {
      const k = normalizeAddress(rawKey);
      if (!historyMap.has(k)) {
        historyMap.set(k, { createdAtBlock: null, revokedAtBlock: null, manual: true });
      }
    }
  }

  const keys = Array.from(historyMap.keys());
  const sessions = await Promise.all(
    keys.map(async sessionKey => {
      const [validHex, spentHex] = await Promise.all([
        l2Rpc.ethCall(contracts.L2.CawProfileLedger, encodeAddressAddressCall(SELECTORS.validSession, owner, sessionKey)),
        l2Rpc.ethCall(contracts.L2.CawActions, encodeAddressAddressCall(SELECTORS.sessionSpent, owner, sessionKey)),
      ]);
      const stored = decodeStoredSession(validHex);
      const spent = decodeSingleUint(spentHex);
      const hist = historyMap.get(sessionKey);

      let status = 'inactive';
      if (stored.expiry === 0) {
        status = hist?.revokedAtBlock ? 'revoked' : hist?.createdAtBlock ? 'invalidated' : 'not_found';
      } else if (stored.expiry <= nowSec) {
        status = 'expired';
      } else {
        status = 'active';
      }

      return {
        sessionKey,
        status,
        ...stored,
        scopes: decodeScopeBitmap(stored.scopeBitmap),
        spent,
        history: hist,
      };
    }),
  );

  sessions.sort((a, b) => {
    const rank = s => (s === 'active' ? 0 : s === 'expired' ? 1 : 2);
    return rank(a.status) - rank(b.status) || b.expiry - a.expiry;
  });

  return {
    ownerSessionEpoch: Number(decodeSingleUint(epochHex)),
    sessionNonce: Number(decodeSingleUint(nonceHex)),
    sessions,
    logError,
    logTruncated,
  };
}

export async function inspectMarketplace(l1Rpc, owner, contracts, { maxScanIds = 150, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const mp = contracts.L1.CawProfileMarketplace;
  const [ethPayoutHex, cawPayoutHex, nextOfferHex, nextListingHex] = await Promise.all([
    l1Rpc.ethCall(mp, encodeAddressArgCall(SELECTORS.pendingPayouts, owner)),
    l1Rpc.ethCall(mp, encodeAddressAddressCall(SELECTORS.pendingTokenPayouts, owner, contracts.L1.MintableCaw)),
    l1Rpc.ethCall(mp, SELECTORS.nextOfferId),
    l1Rpc.ethCall(mp, SELECTORS.nextListingId),
  ]);

  const nextOfferId = Number(decodeSingleUint(nextOfferHex));
  const nextListingId = Number(decodeSingleUint(nextListingHex));

  const offerStart = Math.max(1, nextOfferId - maxScanIds);
  const offerIds = [];
  for (let id = offerStart; id < nextOfferId; id++) offerIds.push(id);

  const listingStart = Math.max(1, nextListingId - maxScanIds);
  const listingIds = [];
  for (let id = listingStart; id < nextListingId; id++) listingIds.push(id);

  const [offerRows, listingRows] = await Promise.all([
    Promise.all(
      offerIds.map(async id => {
        const hex = await l1Rpc.ethCall(mp, encodeUintArgCall(SELECTORS.offers, id));
        const o = decodeOffer(hex);
        return { offerId: id, ...o, expired: o.expiry > 0 && o.expiry <= nowSec };
      }),
    ),
    Promise.all(
      listingIds.map(async id => {
        const [listHex, retHex] = await Promise.all([
          l1Rpc.ethCall(mp, encodeUintArgCall(SELECTORS.listings, id)),
          l1Rpc.ethCall(mp, encodeAddressUintCall(SELECTORS.pendingReturns, owner, id)),
        ]);
        const l = decodeListing(listHex);
        return {
          listingId: id,
          ...l,
          pendingReturn: decodeSingleUint(retHex),
        };
      }),
    ),
  ]);

  return {
    pendingEthPayout: decodeSingleUint(ethPayoutHex),
    pendingCawPayout: decodeSingleUint(cawPayoutHex),
    nextOfferId,
    nextListingId,
    offerScanTruncated: offerStart > 1,
    listingScanTruncated: listingStart > 1,
    myActiveOffers: offerRows.filter(o => o.active && o.offerer === owner),
    myActiveListings: listingRows.filter(l => l.active && l.seller === owner),
    refundableBids: listingRows.filter(l => l.pendingReturn > 0n),
  };
}
