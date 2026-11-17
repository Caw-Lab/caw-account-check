// Minimal JSON-RPC client with chainId verification and adaptive chunked eth_getLogs.

export class RpcError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.status = status;
  }
}

export function createRpcClient(url, { expectedChainId, timeoutMs = 12_000, fetchImpl = globalThis.fetch } = {}) {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    throw new Error('RPC URL must start with https:// or http://');
  }
  let nextId = 1;
  let chainVerified = false;

  async function callRaw(method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new RpcError(`HTTP ${res.status} from RPC: ${txt.slice(0, 140)}`, { status: res.status });
      }
      const data = await res.json();
      if (data?.error) {
        throw new RpcError(`RPC error (${data.error.code ?? 'unknown'}): ${data.error.message ?? 'unknown'}`, {
          code: data.error.code,
        });
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureChainId() {
    if (chainVerified || !expectedChainId) return;
    const hexId = await callRaw('eth_chainId');
    const actual = Number(BigInt(hexId));
    if (actual !== expectedChainId) {
      throw new RpcError(`RPC chainId mismatch: expected ${expectedChainId}, got ${actual}`);
    }
    chainVerified = true;
  }

  async function getBlockNumber() {
    await ensureChainId();
    const hex = await callRaw('eth_blockNumber');
    return Number(BigInt(hex));
  }

  async function getCode(address) {
    await ensureChainId();
    return callRaw('eth_getCode', [address, 'latest']);
  }

  async function ethCall(to, data) {
    await ensureChainId();
    return callRaw('eth_call', [{ to, data }, 'latest']);
  }

  function isRangeLimitError(err) {
    if (err?.status === 413) return true;
    const msg = String(err?.message || '').toLowerCase();
    return (
      msg.includes('range') ||
      msg.includes('too large') ||
      msg.includes('exceed') ||
      msg.includes('limit') ||
      msg.includes('more than')
    );
  }

  // Scans [fromBlock, toBlock] newest-first with adaptive chunk shrinking on RPC range caps.
  async function getLogsChunked({ address, topics, fromBlock, toBlock, initialChunk = 45_000, minChunk = 200, maxChunks = 40 }) {
    await ensureChainId();
    const logs = [];
    let cursor = Math.max(0, toBlock);
    const floor = Math.max(0, fromBlock);
    let chunk = Math.max(minChunk, initialChunk);
    let chunksUsed = 0;
    let truncated = false;

    while (cursor >= floor) {
      if (chunksUsed >= maxChunks) {
        truncated = true;
        break;
      }
      const start = Math.max(floor, cursor - chunk + 1);
      try {
        const res = await callRaw('eth_getLogs', [{
          address,
          topics,
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + cursor.toString(16),
        }]);
        if (Array.isArray(res)) logs.push(...res);
        cursor = start - 1;
        chunksUsed++;
      } catch (err) {
        if (isRangeLimitError(err) && chunk > minChunk) {
          chunk = Math.max(minChunk, Math.floor(chunk / 4));
          continue;
        }
        throw err;
      }
    }

    // Sort chronologically (blockNumber, logIndex)
    logs.sort((a, b) => {
      const ba = Number(BigInt(a.blockNumber || '0x0'));
      const bb = Number(BigInt(b.blockNumber || '0x0'));
      if (ba !== bb) return ba - bb;
      return Number(BigInt(a.logIndex || '0x0')) - Number(BigInt(b.logIndex || '0x0'));
    });

    return {
      logs,
      scannedFrom: Math.max(floor, cursor + 1),
      scannedTo: toBlock,
      chunksUsed,
      truncated,
    };
  }

  return {
    url,
    callRaw,
    ensureChainId,
    getBlockNumber,
    getCode,
    ethCall,
    getLogsChunked,
  };
}
