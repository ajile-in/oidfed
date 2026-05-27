import type { JWK } from "@oidfed/core";
import type { DIDDocument } from "./types.js";

/**
 * Pluggable DID method driver interface.
 *
 * Every concrete DID method (hedera, hiero, polygon, etc.) must implement
 * this contract so that federation logic can resolve, validate, and extract
 * signing keys without tight coupling to any blockchain or ledger.
 */
export interface DIDMethodDriver {
	/** The DID method name, e.g. `"hedera"`, `"hiero"`, `"polygon"`. */
	method(): string;

	/**
	 * Resolve a DID to its DID Document.
	 * Throws if the DID is malformed, unresolvable, or the network is unreachable.
	 */
	resolve(did: string): Promise<DIDDocument>;

	/**
	 * Validate that a DID is structurally valid AND resolvable.
	 * Returns `false` without throwing on unresolvable DIDs.
	 */
	validate(did: string): Promise<boolean>;

	/**
	 * Extract all verification keys from the DID document that are suitable
	 * for signing (capabilityInvocation, assertionMethod, or general
	 * verificationMethod entries with a JWK representation).
	 *
	 * Returns an empty array if no keys are found.
	 */
	getSigningKeys(did: string): Promise<JWK[]>;

	/**
	 * Whether this DID method supports anchoring transactions on a
	 * blockchain / ledger (i.e. the DID can be updated or deactivated
	 * via an on-ledger operation).
	 */
	supportsAnchoring(): boolean;
}
