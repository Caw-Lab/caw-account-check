// Minimal dependency-free ABI encoder/decoder and hex formatting helpers.

import { ACTION_SCOPE_NAMES, LISTING_TYPES, MAX_UINT256 } from './contracts.js';

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function strip0x(hex) {
  return typeof hex === 'string' && (hex.startsWith('0x') || hex.startsWith('0X'))
    ? hex.slice(2)
    : String(hex || '');
}

export function isValidAddress(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/i.test(addr.trim());
}

export function normalizeAddress(addr) {
  if (!isValidAddress(addr)) {
    throw new Error(`Invalid address: ${addr}`);
  }
  return '0x' + addr.trim().slice(2).toLowerCase();
}

export function padAddress(addr) {
  return normalizeAddress(addr).slice(2).padStart(64, '0');
}

export function padUint(value) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) throw new Error('Negative uint not supported');
  return n.toString(16).padStart(64, '0');
}

export function encodeAddressArgCall(selector, address) {
  return selector + padAddress(address);
}

export function encodeUintArgCall(selector, value) {
  return selector + padUint(value);
}

export function encodeAddressAddressCall(selector, a, b) {
  return selector + padAddress(a) + padAddress(b);
}

export function encodeAddressUintCall(selector, addr, num) {
  return selector + padAddress(addr) + padUint(num);
}

export function encodeStringArgCall(selector, str) {
  const bytes = utf8Encoder.encode(str);
  const offset = padUint(32);
  const len = padUint(bytes.length);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  const rem = bytes.length % 32;
  if (rem !== 0) hex += '00'.repeat(32 - rem);
  return selector + offset + len + hex;
}

function readWordHex(rawHex, byteOffset) {
  const start = byteOffset * 2;
  if (start + 64 > rawHex.length) {
    throw new Error(`ABI out of bounds at byte ${byteOffset} (len=${rawHex.length / 2})`);
  }
  return rawHex.slice(start, start + 64);
}

export function readUint(rawHex, byteOffset) {
  return BigInt('0x' + readWordHex(rawHex, byteOffset));
}

export function readBool(rawHex, byteOffset) {
  return readUint(rawHex, byteOffset) !== 0n;
}

export function readAddress(rawHex, byteOffset) {
  return '0x' + readWordHex(rawHex, byteOffset).slice(24).toLowerCase();
}

export function readDynamicString(rawHex, structBaseByteOffset, offsetSlotByteOffset) {
  const relOffset = Number(readUint(rawHex, offsetSlotByteOffset));
  const strStart = structBaseByteOffset + relOffset;
  const byteLen = Number(readUint(rawHex, strStart));
  const hexStart = (strStart + 32) * 2;
  const hexEnd = hexStart + byteLen * 2;
  if (hexEnd > rawHex.length) {
    throw new Error(`ABI string out of bounds (need ${hexEnd}, got ${rawHex.length})`);
  }
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = parseInt(rawHex.slice(hexStart + i * 2, hexStart + i * 2 + 2), 16);
  }
  return utf8Decoder.decode(bytes);
}

export function decodeSingleUint(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 64) return 0n;
  return readUint(raw, 0);
}

export function decodeSingleAddress(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 64) return null;
  return readAddress(raw, 0);
}

export function decodeSingleString(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 128) return '';
  return readDynamicString(raw, 0, 0);
}

// Decodes CawProfileLens.tokenByUsername(string) -> struct Token
export function decodeLensToken(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 64) throw new Error('Empty tokenByUsername response');
  const structStart = Number(readUint(raw, 0));
  return {
    tokenId: Number(readUint(raw, structStart)),
    username: readDynamicString(raw, structStart, structStart + 32),
    owner: readAddress(raw, structStart + 64),
    ownerBalance: readUint(raw, structStart + 96),
    withdrawable: readUint(raw, structStart + 128),
  };
}

// Decodes CawProfileLens.profilesWithNetworkState(address,uint32) -> TokenWithNetworkState[]
export function decodeProfilesWithNetworkState(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 128) return [];
  const arrayStart = Number(readUint(raw, 0));
  const count = Number(readUint(raw, arrayStart));
  const elemsBase = arrayStart + 32;
  const items = [];
  for (let i = 0; i < count; i++) {
    const relOffset = Number(readUint(raw, elemsBase + i * 32));
    const s = elemsBase + relOffset;
    items.push({
      tokenId: Number(readUint(raw, s)),
      username: readDynamicString(raw, s, s + 32),
      owner: readAddress(raw, s + 64),
      ownerBalance: readUint(raw, s + 96),
      withdrawable: readUint(raw, s + 128),
      authenticated: readBool(raw, s + 160),
      withdrawFeeLocked: readBool(raw, s + 192),
      lockedWithdrawFee: readUint(raw, s + 224),
    });
  }
  return items;
}

// Decodes CawProfileLedger.validSession(address,address) -> StoredSession
export function decodeStoredSession(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 384) {
    throw new Error('Invalid StoredSession response length');
  }
  return {
    expiry: Number(readUint(raw, 0)),
    scopeBitmap: Number(readUint(raw, 32)),
    epoch: Number(readUint(raw, 64)),
    perActionTipRate: readUint(raw, 96),
    profileId: Number(readUint(raw, 128)),
    spendLimit: readUint(raw, 160),
  };
}

// Decodes CawProfileMarketplace.offers(uint256)
export function decodeOffer(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 384) throw new Error('Invalid Offer response length');
  return {
    offerer: readAddress(raw, 0),
    tokenId: Number(readUint(raw, 32)),
    paymentToken: readAddress(raw, 64),
    amount: readUint(raw, 96),
    expiry: Number(readUint(raw, 128)),
    active: readBool(raw, 160),
  };
}

// Decodes CawProfileMarketplace.listings(uint256)
export function decodeListing(hexResult) {
  const raw = strip0x(hexResult);
  if (raw.length < 704) throw new Error('Invalid Listing response length');
  const typeIdx = Number(readUint(raw, 96));
  return {
    tokenId: Number(readUint(raw, 0)),
    seller: readAddress(raw, 32),
    paymentToken: readAddress(raw, 64),
    listingType: LISTING_TYPES[typeIdx] ?? `UNKNOWN(${typeIdx})`,
    startPrice: readUint(raw, 128),
    endPrice: readUint(raw, 160),
    startTime: Number(readUint(raw, 192)),
    endTime: Number(readUint(raw, 224)),
    highestBid: readUint(raw, 256),
    highestBidder: readAddress(raw, 288),
    active: readBool(raw, 320),
  };
}

export function decodeScopeBitmap(bitmap) {
  const allowed = [];
  for (let bit = 0; bit < ACTION_SCOPE_NAMES.length; bit++) {
    if ((bitmap & (1 << bit)) !== 0) {
      allowed.push(ACTION_SCOPE_NAMES[bit]);
    }
  }
  return allowed;
}

// EIP-7702 delegation indicator: 0xef0100 || 20-byte delegate address (total 23 bytes = 46 hex chars)
export function parseEip7702Code(codeHex) {
  const clean = strip0x(codeHex).toLowerCase();
  if (!clean) return { delegated: false, delegate: null, codeBytes: 0, isEoa: true };
  if (clean.length === 46 && clean.startsWith('ef0100')) {
    return {
      delegated: true,
      delegate: '0x' + clean.slice(6),
      codeBytes: 23,
      isEoa: false,
    };
  }
  return {
    delegated: false,
    delegate: null,
    codeBytes: clean.length / 2,
    isEoa: false,
  };
}

export function formatUnits(value, decimals = 18, maxFrac = 4) {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v === 0n) return '0';
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac === 0n || maxFrac <= 0) return (neg ? '-' : '') + wholeStr;
  const fracFull = frac.toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
  return (neg ? '-' : '') + (fracFull ? `${wholeStr}.${fracFull}` : wholeStr);
}

export function formatAllowance(value, decimals = 18) {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v >= MAX_UINT256 / 2n) {
    return { text: '無制限', sub: 'Unlimited (MaxUint256)', unlimited: true };
  }
  if (v === 0n) {
    return { text: '0 (承認なし)', sub: null, unlimited: false };
  }
  return { text: `${formatUnits(v, decimals)} CAW`, sub: null, unlimited: false };
}

export function shortAddr(addr) {
  if (!addr || addr.length < 12) return String(addr || '');
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}
