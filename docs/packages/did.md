# @oidfed/did

Pluggable DID method drivers for blockchain-anchored identifiers — hedera, hiero, polygon. Provides DID resolution, document validation, and JWK extraction for OpenID Federation trust integration.

## Install

```bash
pnpm add @oidfed/core @oidfed/did
```

## Architecture

DID method drivers are **isolated, pluggable modules** that implement the `DIDMethodDriver` interface. Resolution goes through configurable HTTP endpoints (mirror nodes, permissioned gateways, Universal Resolver, JSON-RPC). No blockchain consensus logic or smart contracts are implemented in this package.

```
Federation Logic
       │
       ▼
DIDDriverRegistry.getForDid("did:hedera:…")
       │
       ├── HederaDIDDriver  ──► mirror node REST API
       ├── HieroDIDDriver   ──► permissioned gateway
       └── PolygonDIDDriver ──► Universal Resolver / JSON-RPC
```

## Quick Start

```ts
import { createDefaultRegistry } from "@oidfed/did";

const registry = createDefaultRegistry({
  hedera: {},
  polygon: { rpcUrl: "https://polygon-rpc.com" },
});

// Resolve a DID
const doc = await registry
  .getForDid("did:hedera:mainnet:0.0.12345")
  .resolve("did:hedera:mainnet:0.0.12345");

console.log(doc.id); // "did:hedera:mainnet:0.0.12345"
console.log(doc.verificationMethod?.[0]?.publicKeyJwk);
```

## API

### DIDMethodDriver

The core interface every driver implements:

```ts
import type { DIDMethodDriver } from "@oidfed/did";

interface DIDMethodDriver {
  /** The DID method name, e.g. "hedera", "hiero", "polygon". */
  method(): string;

  /** Resolve a DID to its DID Document. Throws on failure. */
  resolve(did: string): Promise<DIDDocument>;

  /** Validate that a DID is structurally valid AND resolvable. */
  validate(did: string): Promise<boolean>;

  /** Extract signing-capable verification keys as JWK[]. */
  getSigningKeys(did: string): Promise<JWK[]>;

  /** Whether the DID method supports on-ledger anchoring operations. */
  supportsAnchoring(): boolean;
}
```

### DIDDriverRegistry

Manages method → driver lookups:

```ts
import { DIDDriverRegistry } from "@oidfed/did";

// Create with initial drivers
const registry = new DIDDriverRegistry([
  new HederaDIDDriver(),
  new PolygonDIDDriver(),
]);

// Register/unregister
registry.register(new HieroDIDDriver());
registry.unregister("hiero");

// Lookup
const driver = registry.getForDid("did:hedera:mainnet:0.0.12345");
//      ^? HederaDIDDriver

// List all registered methods
registry.methods(); // ["hedera", "polygon"]
```

### createDefaultRegistry

Convenience factory pre-loaded with all three built-in drivers. Accepts an optional per-method config record:

```ts
import { createDefaultRegistry } from "@oidfed/did";

const registry = createDefaultRegistry({
  hedera: { endpoints: { mainnet: "https://custom-mirror.example.com" } },
  hiero: { network: "enterprise" },
  polygon: { rpcUrl: "https://polygon-rpc.com" },
});
```

### Utilities

```ts
import { parseDid, isValidDid, extractSigningKeys, normalizeJwk } from "@oidfed/did";

// Parse a DID into [method, methodSpecificId]
const [method, id] = parseDid("did:hedera:mainnet:0.0.12345");
// method = "hedera", id = "mainnet:0.0.12345"

// Validate DID syntax (no network call)
isValidDid("did:polygon:amoy:0xabc"); // true
isValidDid("not-a-did");             // false

// Extract keys from a resolved DID document
const keys = extractSigningKeys(didDocument); // JWK[]

// Normalize a JWK (infer kty, set default use)
const normalized = normalizeJwk({ crv: "secp256k1", x: "…", y: "…" });
// normalized.kty = "EC", normalized.use = "sig"
```

### Types

Selected key types:

```ts
import type {
  DIDDocument,
  VerificationMethod,
  DIDServiceEndpoint,
  GovernanceAwareDIDDocument,
  GovernanceMetadata,
  FederationTrustInfo,
  DIDResolutionResult,
  DIDDriverConfig,
} from "@oidfed/did";
```

For the full type surface, see `src/types.ts`.

## Drivers

### HederaDIDDriver

Resolves DIDs published via the Hedera Consensus Service (HCS) using the Hedera mirror node REST API.

- **DID format:** `did:hedera:{network}:{id}`
- **Networks:** `mainnet` (default), `testnet`, `previewnet`
- **Resolution:** `GET /api/v1/accounts/{address}/did`
- **Anchoring:** yes (HCS)

```ts
import { HederaDIDDriver } from "@oidfed/did";

const driver = new HederaDIDDriver({
  endpoints: { mainnet: "https://mainnet-public.mirrornode.hedera.com" },
});

const doc = await driver.resolve("did:hedera:testnet:0.0.12345");
const keys = await driver.getSigningKeys("did:hedera:testnet:0.0.12345");
```

### HieroDIDDriver

Extends the Hedera DID pattern for LF Hyperledger Hiero permissioned ecosystems. Attaches governance metadata (ecosystem, permissions model, federation trust references) when available from the gateway.

- **DID format:** `did:hiero:{network}:{ecosystem}:{id}`
- **Governance metadata:** ecosystem, ledgerId, permissionsModel (`permissioned` | `consortium` | `enterprise`), federationTrust
- **Resolution:** `GET /did/{ecosystem}/{id}` with `Accept: application/did+json`

```ts
import { HieroDIDDriver } from "@oidfed/did";

const driver = new HieroDIDDriver({
  network: "enterprise",
  endpoints: { mainnet: "https://permissioned-gateway.example.com" },
});

const doc = await driver.resolve("did:hiero:mainnet:enterprise:alice");

// Access governance metadata (available if gateway provides it)
const govDoc = doc as GovernanceAwareDIDDocument;
console.log(govDoc.governance?.permissionsModel); // "permissioned"
```

### PolygonDIDDriver

Resolves DIDs on Polygon/EVM-compatible networks. Tries the off-chain Universal Resolver first, then falls back to direct EVM JSON-RPC calls against a DID registry contract.

- **DID format:** `did:polygon:{network}:{contractAddress}:{tokenId}` or `did:polygon:{network}:{address}`
- **Networks:** `polygon-mainnet` (default), `polygon-amoy`
- **Resolution:** Universal Resolver → JSON-RPC `eth_call` fallback
- **EVM signatures:** Returns `secp256k1` keys as EC JWKs

```ts
import { PolygonDIDDriver } from "@oidfed/did";

const driver = new PolygonDIDDriver({
  rpcUrl: "https://polygon-rpc.com",
});

const doc = await driver.resolve("did:polygon:polygon-mainnet:0xContract:0xTokenId");
const keys = await driver.getSigningKeys("did:polygon:polygon-mainnet:0xContract:0xTokenId");
```

## Custom Driver

Implement `DIDMethodDriver` to add any DID method:

```ts
import { DIDDriverRegistry, type DIDMethodDriver, type DIDDocument } from "@oidfed/did";
import type { JWK } from "@oidfed/core";

class CheqdDriver implements DIDMethodDriver {
  method(): string { return "cheqd"; }

  async resolve(did: string): Promise<DIDDocument> {
    const resp = await fetch(`https://resolver.cheqd.net/1.0/identifiers/${did}`);
    if (!resp.ok) throw new Error(`resolve failed: ${resp.status}`);
    const body = await resp.json();
    return body.didDocument as DIDDocument;
  }

  async validate(did: string): Promise<boolean> {
    try { await this.resolve(did); return true; }
    catch { return false; }
  }

  async getSigningKeys(did: string): Promise<JWK[]> {
    const { extractSigningKeys } = await import("@oidfed/did");
    return extractSigningKeys(await this.resolve(did));
  }

  supportsAnchoring(): boolean { return true; }
}

const registry = new DIDDriverRegistry([new CheqdDriver()]);
```

## Design Principles

1. **Isolated drivers** — No federation logic is coupled to any blockchain. A driver is a standalone class implementing six methods.
2. **No blockchain consensus** — Resolution uses HTTP calls to existing infrastructure (mirror nodes, RPC, Universal Resolver).
3. **No smart contracts** — This package reads from contracts but never deploys, writes, or modifies on-chain state.
4. **JWK normalization** — `extractSigningKeys()` traverses the DID document's `verificationMethod`, `assertionMethod`, `capabilityInvocation`, and `authentication` sections, resolves references, and returns deduplicated, normalized `JWK[]` ready for federation trust operations.
5. **Governance-extensible** — `GovernanceAwareDIDDocument` adds optional governance metadata for permissioned/enterprise ecosystems without breaking the base interface.

## Errors

```ts
import {
  DIDError,               // base class
  MalformedDIDError,      // invalid DID syntax
  DIDResolutionError,      // network / resolution failure
  DIDValidationError,     // invalid resolved document
  UnsupportedDIDMethodError, // method not registered
} from "@oidfed/did";
```

All errors carry the DID that caused them:

```ts
try {
  await registry.getForDid("did:unknown:123").resolve("did:unknown:123");
} catch (e) {
  if (e instanceof UnsupportedDIDMethodError) {
    console.log(e.did); // "did:unknown:123"
    console.log(e.message); // 'Unsupported DID method: "unknown"'
  }
}
```
