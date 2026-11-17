// Contract addresses, selectors, and event topic0 hashes derived from
// GilgameshCaw/Caw solidity/contracts/ (MIT) & client/src/abi/deployments.ts (commit 97cd13f3).

export const NETWORK_PRESETS = {
  testnet: {
    id: 'testnet',
    label: 'Testnet (Sepolia + Base Sepolia / Network 1)',
    networkId: 1,
    l1ChainId: 11155111,
    l1ChainName: 'Ethereum Sepolia',
    l1DefaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    l1Explorer: 'https://sepolia.etherscan.io',
    l2ChainId: 84532,
    l2ChainName: 'Base Sepolia',
    l2DefaultRpc: 'https://base-sepolia-rpc.publicnode.com',
    l2Explorer: 'https://sepolia.basescan.org',
    contracts: {
      L1: {
        MintableCaw: '0x56817dc696448135203C0556f702c6a953260411',
        CawProfile: '0x3BA577936Ff6Cfe07DC2D00e6669436C6Dace319',
        CawProfileMinter: '0x5613353c6B6F55fBc82487D36a5316A2cAdE7Ee0',
        CawProfileLens: '0xFfFEF4bD46C222aa566CF1F17e7F47c1eDDE225b',
        CawProfileMarketplace: '0x858F60fC71bAfBdC6Ba170aCC7dc8974F6270CBD',
        SmartEOA: '0x918082aB668D7661bCe65C3CAAF047648f7D4271',
      },
      L2: {
        CawProfileLedger: '0x93593A023629EB84B389770d76A81C5f982F02a9',
        CawActions: '0x73246104f57001EDC6d0659Fa37Afb672a76E763',
        CawActionsERC1271: '0x78AB5d7be8Ba2BC722f58B862c16Ee77fEcbCF74',
        SmartEOA: '0x918082aB668D7661bCe65C3CAAF047648f7D4271',
      },
    },
  },
};

export const SELECTORS = {
  // CawProfileLens (L1)
  tokens: '0xe4860339',                   // tokens(address)
  tokenByUsername: '0x1b65956b',          // tokenByUsername(string)
  profilesWithNetworkState: '0x1807339f', // profilesWithNetworkState(address,uint32)
  // CawProfile / CawProfileLedger
  ownerOf: '0x6352211e',                  // ownerOf(uint256)
  // ERC-20 (CAW)
  allowance: '0xdd62ed3e',                // allowance(address,address)
  balanceOf: '0x70a08231',                // balanceOf(address)
  decimals: '0x313ce567',                 // decimals()
  symbol: '0x95d89b41',                   // symbol()
  // CawProfileLedger (L2)
  cawBalanceOf: '0x3d3bfa27',             // cawBalanceOf(uint32)
  validSession: '0x9223d272',             // validSession(address,address)
  sponsorRepay: '0x2d2ab58c',             // sponsorRepay(uint32)
  ownerSessionEpoch: '0xf8f4d9c7',        // ownerSessionEpoch(address)
  sessionNonce: '0x6d0ae046',             // sessionNonce(address)
  // CawActions (L2)
  sessionSpent: '0x9119fc84',             // sessionSpent(address,address)
  networkActionCount: '0xbe17131d',       // networkActionCount(uint32)
  // CawProfileMarketplace (L1)
  pendingPayouts: '0x784712f2',           // pendingPayouts(address)
  pendingTokenPayouts: '0x806ce79d',      // pendingTokenPayouts(address,address)
  pendingReturns: '0xb15039ab',           // pendingReturns(address,uint256)
  offers: '0x8a72ea6a',                   // offers(uint256)
  listings: '0xde74e57b',                 // listings(uint256)
  nextOfferId: '0x5f5d0655',              // nextOfferId()
  nextListingId: '0xaaccf1ec',            // nextListingId()
  // SmartEOA
  managementNonceOf: '0x233c627f',        // managementNonceOf()
  executeNonceOf: '0x687cda31',           // executeNonceOf()
};

export const TOPICS = {
  // CawProfileLedger
  SessionCreated: '0x81ab30c0cb637e6d75e0599eaa9ebf9e5e44a09fa0c220869b565d29b6acf6d1',
  SessionRevoked: '0x9a20fd73f3c4985be44f081964b55d63f69ed94995474740c82bfbff9d6ab5c4',
  // SmartEOA
  PasskeyAdded: '0x4814a9e3e779038db777441d565e4c633c050a88074907f9551c347973161fa8',
  PasskeyActivated: '0x93970bc2c79658685b7a84437d122acea8d6029ff9d5a5b434c7c6f3438f56b4',
  PasskeyRemoved: '0x6478f30699d78c25aec768184c69105e8f3606c825c91ca4511e96ae6a4e4e1f',
  PasskeyCancelled: '0x398d120d53fc8d67df3ccac15da5e07fdc8f2697f4494ac74f47567192c6b821',
  EcdsaFallbackRotated: '0x13fbce01645c5624635c2b7e65bf7cd8e64267c2d60dafa9b8ad4e4ca2c22ffe',
};

// Solidity enum ActionType { CAW, LIKE, UNLIKE, RECAW, FOLLOW, UNFOLLOW, WITHDRAW, OTHER }
export const ACTION_SCOPE_NAMES = [
  'CAW',
  'LIKE',
  'UNLIKE',
  'RECAW',
  'FOLLOW',
  'UNFOLLOW',
  'WITHDRAW',
  'OTHER',
];

export const LISTING_TYPES = ['FIXED', 'DUTCH_AUCTION', 'ENGLISH_AUCTION'];

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const MAX_UINT256 = (1n << 256n) - 1n;

// Shared EIP-7702 singleton delegators verified on-chain (non-CAW wallet smart accounts).
export const KNOWN_DELEGATORS = {
  '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b': {
    id: 'metamask_7702',
    label: 'MetaMask EIP-7702 Delegator (EIP7702StatelessDeleGator)',
    shortLabel: 'MetaMask EIP-7702 Delegator',
  },
};

export function findKnownDelegator(address) {
  if (!address) return null;
  return KNOWN_DELEGATORS[String(address).toLowerCase()] || null;
}
