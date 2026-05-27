import type { JWK } from "@oidfed/core";
import type { DIDMethodDriver } from "./driver.js";

/** A DID URL — the fully qualified decentralized identifier. */
export type DidUrl = string & { readonly __brand: "DidUrl" };

/** DID document as defined by DID Core 1.0 (minimal subset). */
export interface DIDDocument {
	readonly id: string;
	readonly alsoKnownAs?: readonly string[];
	readonly verificationMethod?: readonly VerificationMethod[];
	readonly authentication?: readonly (string | VerificationMethod)[];
	readonly assertionMethod?: readonly (string | VerificationMethod)[];
	readonly keyAgreement?: readonly (string | VerificationMethod)[];
	readonly capabilityInvocation?: readonly (string | VerificationMethod)[];
	readonly capabilityDelegation?: readonly (string | VerificationMethod)[];
	readonly service?: readonly DIDServiceEndpoint[];
	readonly [key: string]: unknown;
}

/** A single verification method entry within a DID document. */
export interface VerificationMethod {
	readonly id: string;
	readonly type: string;
	readonly controller: string;
	readonly publicKeyJwk?: JWK;
	readonly publicKeyMultibase?: string;
	readonly publicKeyBase58?: string;
	readonly blockchainAccountId?: string;
	readonly ethereumAddress?: string;
	readonly [key: string]: unknown;
}

/** A service endpoint entry within a DID document. */
export interface DIDServiceEndpoint {
	readonly id: string;
	readonly type: string | readonly string[];
	readonly serviceEndpoint: string | Record<string, unknown> | (string | Record<string, unknown>)[];
	readonly [key: string]: unknown;
}

/** Result of a DID resolution operation. */
export interface DIDResolutionResult {
	readonly didDocument: DIDDocument;
	readonly didDocumentMetadata: DIDDocumentMetadata;
	readonly didResolutionMetadata: DIDResolutionMetadata;
}

/** Metadata about the resolved DID document. */
export interface DIDDocumentMetadata {
	readonly created?: string;
	readonly updated?: string;
	readonly deactivated?: boolean;
	readonly versionId?: string;
	readonly nextUpdate?: string;
	readonly [key: string]: unknown;
}

/** Metadata about the resolution process itself. */
export interface DIDResolutionMetadata {
	readonly contentType?: string;
	readonly error?: string;
	readonly [key: string]: unknown;
}

/** Map of DID method names to their drivers. */
export type DIDDriverMap = ReadonlyMap<string, DIDMethodDriver>;

/** DID document with optional governance metadata (hiero-specific). */
export interface GovernanceAwareDIDDocument extends DIDDocument {
	readonly governance?: GovernanceMetadata;
}

/** Governance metadata for permissioned ledger ecosystems. */
export interface GovernanceMetadata {
	readonly ecosystem: string;
	readonly ledgerId?: string;
	readonly network?: string;
	readonly permissionsModel: "permissioned" | "consortium" | "enterprise";
	readonly federationTrust?: FederationTrustInfo[];
}

/** Federation trust information for governance-aware DIDs. */
export interface FederationTrustInfo {
	readonly trustAnchor: string;
	readonly trustFramework: string;
	readonly validityPeriod?: string;
}

/** Configuration for a DID method driver. */
export interface DIDDriverConfig {
	readonly endpoints?: Record<string, string>;
	readonly network?: string;
	readonly rpcUrl?: string;
	readonly [key: string]: unknown;
}
