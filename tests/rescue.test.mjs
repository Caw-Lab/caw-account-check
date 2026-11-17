import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeLensToken,
  decodeListing,
  decodeOffer,
  decodeProfilesWithNetworkState,
  decodeScopeBitmap,
  decodeStoredSession,
  encodeAddressAddressCall,
  encodeStringArgCall,
  formatAllowance,
  formatUnits,
  parseEip7702Code,
} from '../lib/abi.js';
import { MAX_UINT256, NETWORK_PRESETS, SELECTORS } from '../lib/contracts.js';
import { I18N, formatI18n } from '../lib/i18n.js';
import { inspectMarketplace, inspectSessions, resolveTarget } from '../lib/rescue.js';

function padHex32(hexWithout0x) {
  return hexWithout0x.padStart(64, '0');
}

function padRight32(hexWithout0x) {
  const rem = hexWithout0x.length % 64;
  return rem === 0 ? hexWithout0x : hexWithout0x + '0'.repeat(64 - rem);
}

describe('lib/abi', () => {
  it('encodes string calls cleanly', () => {
    const call = encodeStringArgCall(SELECTORS.tokenByUsername, 'alice');
    assert.equal(call.slice(0, 10), SELECTORS.tokenByUsername);
    // offset = 32, len = 5, "alice" = 616c696365
    assert.equal(call.slice(10, 74), padHex32('20'));
    assert.equal(call.slice(74, 138), padHex32('5'));
    assert.equal(call.slice(138, 148), '616c696365');
    assert.equal(call.length, 10 + 64 * 3);
  });

  it('decodes CawProfileLens.tokenByUsername struct', () => {
    const addr = '1111111111111111111111111111111111111111';
    const nameHex = Buffer.from('alice1', 'utf8').toString('hex');
    const encoded =
      '0x' +
      padHex32('20') + // outer offset to Token
      padHex32('3') +  // tokenId = 3
      padHex32('a0') + // string offset = 160 bytes from struct start
      padHex32(addr) + // owner
      padHex32('de0b6b3a7640000') + // ownerBalance = 1e18
      padHex32('0') +  // withdrawable = 0
      padHex32('6') +  // username len
      padRight32(nameHex);

    const decoded = decodeLensToken(encoded);
    assert.equal(decoded.tokenId, 3);
    assert.equal(decoded.username, 'alice1');
    assert.equal(decoded.owner, '0x' + addr);
    assert.equal(decoded.ownerBalance, 1000000000000000000n);
    assert.equal(decoded.withdrawable, 0n);
  });

  it('decodes CawProfileLens.profilesWithNetworkState array', () => {
    const addr = '2222222222222222222222222222222222222222';
    const nameHex = Buffer.from('bob', 'utf8').toString('hex');
    // Outer offset (0x20), length = 1, element[0] offset = 0x20 (32 bytes from elemsBase)
    const structBody =
      padHex32('7') +                   // tokenId = 7
      padHex32((8 * 32).toString(16)) + // offset to username = 256 bytes from struct start
      padHex32(addr) +                  // owner
      padHex32('1bc16d674ec80000') +    // ownerBalance = 2e18
      padHex32('6f05b59d3b20000') +     // withdrawable = 0.5e18
      padHex32('1') +                   // authenticated = true
      padHex32('0') +                   // withdrawFeeLocked = false
      padHex32('0') +                   // lockedWithdrawFee = 0
      padHex32('3') +                   // username length
      padRight32(nameHex);

    const encoded = '0x' + padHex32('20') + padHex32('1') + padHex32('20') + structBody;
    const list = decodeProfilesWithNetworkState(encoded);
    assert.equal(list.length, 1);
    assert.equal(list[0].tokenId, 7);
    assert.equal(list[0].username, 'bob');
    assert.equal(list[0].authenticated, true);
    assert.equal(list[0].withdrawFeeLocked, false);
    assert.equal(list[0].withdrawable, 500000000000000000n);
  });

  it('decodes validSession and scopeBitmap', () => {
    const encoded =
      '0x' +
      padHex32((1800000000).toString(16)) + // expiry
      padHex32((0xbf).toString(16)) +       // scopeBitmap (all except WITHDRAW bit 6)
      padHex32('2') +                       // epoch
      padHex32('64') +                      // perActionTipRate = 100
      padHex32('0') +                       // profileId = 0 (all)
      padHex32('1000');                     // spendLimit = 4096
    const s = decodeStoredSession(encoded);
    assert.equal(s.expiry, 1800000000);
    assert.equal(s.scopeBitmap, 0xbf);
    assert.equal(s.epoch, 2);
    assert.equal(s.perActionTipRate, 100n);
    assert.equal(s.profileId, 0);
    assert.equal(s.spendLimit, 4096n);
    assert.deepEqual(decodeScopeBitmap(s.scopeBitmap), [
      'CAW', 'LIKE', 'UNLIKE', 'RECAW', 'FOLLOW', 'UNFOLLOW', 'OTHER',
    ]);
  });

  it('decodes Offer and Listing structs', () => {
    const addr = '3333333333333333333333333333333333333333';
    const offerHex =
      '0x' +
      padHex32(addr) +
      padHex32('5') +
      padHex32('0') +
      padHex32('de0b6b3a7640000') +
      padHex32('69000000') +
      padHex32('1');
    const offer = decodeOffer(offerHex);
    assert.equal(offer.offerer, '0x' + addr);
    assert.equal(offer.tokenId, 5);
    assert.equal(offer.active, true);

    const listingHex =
      '0x' +
      padHex32('5') +
      padHex32(addr) +
      padHex32('0') +
      padHex32('2') + // ENGLISH_AUCTION
      padHex32('64') +
      padHex32('0') +
      padHex32('1000') +
      padHex32('2000') +
      padHex32('c8') +
      padHex32(addr) +
      padHex32('1');
    const listing = decodeListing(listingHex);
    assert.equal(listing.listingType, 'ENGLISH_AUCTION');
    assert.equal(listing.highestBid, 200n);
    assert.equal(listing.active, true);
  });

  it('parses EIP-7702 delegation bytecode', () => {
    assert.deepEqual(parseEip7702Code('0x'), {
      delegated: false,
      delegate: null,
      codeBytes: 0,
      isEoa: true,
    });
    const del = parseEip7702Code('0xef0100918082aB668D7661bCe65C3CAAF047648f7D4271');
    assert.equal(del.delegated, true);
    assert.equal(del.delegate, '0x918082ab668d7661bce65c3caaf047648f7d4271');
    assert.equal(del.codeBytes, 23);
  });

  it('formats units and unlimited allowance safely', () => {
    assert.equal(formatUnits(1500000000000000000n, 18), '1.5');
    assert.equal(formatUnits(1234567000000000000000000n, 18), '1,234,567');
    assert.equal(formatAllowance(MAX_UINT256).unlimited, true);
    assert.equal(formatAllowance(0n).unlimited, false);
  });
});

describe('lib/rescue', () => {
  const preset = NETWORK_PRESETS.testnet;

  it('resolves direct address and tokenId', async () => {
    const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const fakeL1 = {
      async ethCall(to, data) {
        if (to === preset.contracts.L1.CawProfile && data.startsWith(SELECTORS.ownerOf)) {
          return '0x' + padHex32(owner.slice(2));
        }
        throw new Error(`unexpected call ${to} ${data}`);
      },
    };

    const byAddr = await resolveTarget(fakeL1, owner.toUpperCase(), preset.contracts.L1);
    assert.equal(byAddr.address, owner);
    assert.equal(byAddr.resolvedVia, 'address');

    const byId = await resolveTarget(fakeL1, '#3', preset.contracts.L1);
    assert.equal(byId.address, owner);
    assert.equal(byId.resolvedVia, 'tokenId');
    assert.equal(byId.tokenId, 3);
  });

  it('inspects manual session keys even when getLogs fails', async () => {
    const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const sessionKey = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const fakeL2 = {
      async ethCall(to, data) {
        if (data.startsWith(SELECTORS.ownerSessionEpoch)) return '0x' + padHex32('1');
        if (data.startsWith(SELECTORS.sessionNonce)) return '0x' + padHex32('4');
        if (data === encodeAddressAddressCall(SELECTORS.validSession, owner, sessionKey)) {
          return (
            '0x' +
            padHex32((2000000000).toString(16)) +
            padHex32((0xbf).toString(16)) +
            padHex32('1') +
            padHex32('0') +
            padHex32('0') +
            padHex32('3e8')
          );
        }
        if (data === encodeAddressAddressCall(SELECTORS.sessionSpent, owner, sessionKey)) {
          return '0x' + padHex32('64');
        }
        throw new Error(`unexpected call ${to} ${data}`);
      },
      async getLogsChunked() {
        throw new Error('HTTP 413 block range too large');
      },
    };

    const res = await inspectSessions(fakeL2, owner, 1000, preset.contracts, {
      extraSessionKeys: [sessionKey],
      nowSec: 1700000000,
    });
    assert.equal(res.ownerSessionEpoch, 1);
    assert.equal(res.sessionNonce, 4);
    assert.match(res.logError, /413/);
    assert.equal(res.sessions.length, 1);
    assert.equal(res.sessions[0].status, 'active');
    assert.equal(res.sessions[0].spent, 100n);
    assert.equal(res.sessions[0].spendLimit, 1000n);
  });

  it('scans marketplace offers and pendingReturns', async () => {
    const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const mp = preset.contracts.L1.CawProfileMarketplace;
    const fakeL1 = {
      async ethCall(to, data) {
        assert.equal(to, mp);
        if (data.startsWith(SELECTORS.pendingPayouts)) return '0x' + padHex32('de0b6b3a7640000');
        if (data.startsWith(SELECTORS.pendingTokenPayouts)) return '0x' + padHex32('0');
        if (data === SELECTORS.nextOfferId) return '0x' + padHex32('2');
        if (data === SELECTORS.nextListingId) return '0x' + padHex32('2');
        if (data.startsWith(SELECTORS.offers)) {
          return (
            '0x' +
            padHex32(owner.slice(2)) +
            padHex32('3') +
            padHex32('0') +
            padHex32('6f05b59d3b20000') +
            padHex32('64') + // expired
            padHex32('1')
          );
        }
        if (data.startsWith(SELECTORS.listings)) {
          return '0x' + padHex32('0').repeat(11);
        }
        if (data.startsWith(SELECTORS.pendingReturns)) {
          return '0x' + padHex32('1bc16d674ec80000');
        }
        throw new Error(`unexpected ${data}`);
      },
    };

    const res = await inspectMarketplace(fakeL1, owner, preset.contracts, { nowSec: 2000 });
    assert.equal(res.pendingEthPayout, 1000000000000000000n);
    assert.equal(res.myActiveOffers.length, 1);
    assert.equal(res.myActiveOffers[0].expired, true);
    assert.equal(res.refundableBids.length, 1);
    assert.equal(res.refundableBids[0].pendingReturn, 2000000000000000000n);
  });
});

describe('lib/i18n', () => {
  it('keeps identical key sets for ja and en and covers all template keys', () => {
    const jaKeys = Object.keys(I18N.ja).sort();
    const enKeys = Object.keys(I18N.en).sort();
    assert.deepEqual(jaKeys, enKeys);

    const tpl = fs.readFileSync(path.resolve(import.meta.dirname, '../index.template.html'), 'utf8');
    for (const m of tpl.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
      const k = m[1];
      assert.ok(k in I18N.ja, `Missing ja key: ${k}`);
      assert.ok(k in I18N.en, `Missing en key: ${k}`);
    }

    assert.equal(formatI18n('en', 'sum3_ok_st', { n: 2 }), 'Healthy: All 2 Synced');
  });
});
