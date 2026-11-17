# CAW Account Check

An unofficial, node-independent, read-only on-chain account checker for [CAW Protocol (V2)](https://github.com/GilgameshCaw/Caw).  
Query Ethereum Sepolia (L1) and Base Sepolia (L2) RPC endpoints directly from your browser without talking to any CAW community node API.

**Open it: https://zinsanjp.github.io/caw-account-check/**

*Not affiliated with or endorsed by the CAW project. Prototype for **Testnet** (`GilgameshCaw/Caw` commit `97cd13f3`).*

---

## What it checks (Read-Only)

- **Quick Health Summary**: 5-card overview highlighting delegation, token allowances, L1/L2 sync, active L2 session keys, and unclaimed Marketplace funds.
- **Account & Permission Security (L1 / L2)**:
  - EIP-7702 delegation status (`eth_getCode`) compared against the reference `SmartEOA` address
  - Recent `SmartEOA` Passkey / fallback events & nonces
  - `CAW` (ERC-20) allowances for `CawProfileMinter`, `CawProfile`, `CawProfileMarketplace`, and optional custom spenders
- **Owned Profiles & L1 / L2 Sync**: `CawProfileLens.profilesWithNetworkState` (L1) cross-checked against `CawProfileLedger` (`cawBalanceOf`, `ownerOf`, `sponsorRepay`) on L2.
- **L2 Session Keys (Quick Sign)**: `ownerSessionEpoch`, `sessionNonce`, recent `SessionCreated` / `SessionRevoked` logs, and manual `sessionKey` inspection via `validSession` and `sessionSpent`.
- **Marketplace Unclaimed Funds (L1)**: `pendingPayouts` (ETH), `pendingTokenPayouts` (CAW), `pendingReturns` (outbid auction refunds), and active/expired offers & listings.

## Security & Privacy Notes

- **No wallet connection, no private keys, no signatures, no transactions**: Everything is strictly read-only (`eth_call`, `eth_getCode`, `eth_getLogs`). This page does not claim funds or revoke permissions directly.
- **Zero backend / zero third-party CDN scripts**: Runs completely as a standalone static HTML file (`index.html`). You can download `index.html` and inspect or open it locally.
- **RPC metadata**: Queries go directly from your browser to the L1 / L2 RPC URLs configured on the page. Using the default public RPCs exposes your IP address and the queried address/`@username` to those RPC providers; you can substitute your own RPC URLs under the advanced options.

## Run Locally or on GitHub Pages

`index.html` at the repository root is a self-contained single-file build (CSS and JS inlined, no build step required):

1. **Open directly**: Open `index.html` in a browser (`file://`).
2. **Or serve locally**:
   ```bash
   git clone https://github.com/Zinsanjp/caw-account-check.git
   cd caw-account-check
   python3 -m http.server 8787 --bind 127.0.0.1
   ```
   Then open `http://127.0.0.1:8787/`.
3. **GitHub Pages**: Live at <https://zinsanjp.github.io/caw-account-check/> (published from the `main` branch, `/ (root)`).

## Development & Tests

Requires Node.js 22+ (no npm install needed):

```bash
# Run unit tests
node --test tests/*.test.mjs

# Rebuild standalone index.html after editing lib/*.js, app.js, style.css, or index.template.html
node scripts/build-html.mjs
```

---

## 日本語ガイド

**公開ページ（GitHub Pages）**: https://zinsanjp.github.io/caw-account-check/

どのコミュニティノードの API にも依存せず、ブラウザから直接 L1 / L2 の RPC（または自分の RPC）へ問い合わせてアカウント状態を点検する、ビルド不要・読み取り専用の試作ツールです（**Sepolia / Base Sepolia Testnet・コミット `97cd13f3` 基準、非公式**）。

### 主な機能（読み取り専用）
1. **ひと目チェック**: 委任・Approve・L1/L2 同期・L2 セッション鍵・Marketplace 未回収分の 5 項目をサマリー表示
2. **アカウント・権限セキュリティ**: L1/L2 EIP-7702 委任先確認、Passkey ログ履歴、`CAW` Approve 残高
3. **プロフィール ＆ L1/L2 残高突合**: L1 出金可能額・手数料ロック・L2 残高・L1/L2 所有者一致確認
4. **L2 セッション鍵**: `SessionCreated` ログ走査と手動指定キーによる有効期限・スコープ・利用枠確認
5. **Marketplace 未回収資金**: ETH / CAW 売却益、入札返金、期限切れオファーの確認

### セキュリティ・プライバシー上の注意
- ウォレット接続・秘密鍵入力・署名・トランザクション送信・回収操作は一切行いません（表示専用）。
- 外部 CDN やバックエンドを使わない自己完結型の `index.html` なので、ローカルへ保存してそのまま開くことも可能です。
- ブラウザから直接 RPC へ照会するため、デフォルトの公開 RPC を使う場合は接続元 IP と照会対象が RPC 提供者に伝わります。気になる場合は設定欄からご自身の RPC URL へ変更してください。

### ライセンス

[MIT](LICENSE)
