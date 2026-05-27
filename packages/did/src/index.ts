import { HederaDIDDriver } from "./methods/hedera/index.js";
import { HieroDIDDriver } from "./methods/hiero/index.js";
import { PolygonDIDDriver } from "./methods/polygon/index.js";
import { DIDDriverRegistry } from "./registry.js";
import type { DIDDriverConfig } from "./types.js";

// DID Method Driver interface
export type { DIDMethodDriver } from "./driver.js";
// Errors
export {
	DIDError,
	DIDResolutionError,
	DIDValidationError,
	MalformedDIDError,
	UnsupportedDIDMethodError,
} from "./errors.js";
// DID method drivers
export { HederaDIDDriver } from "./methods/hedera/index.js";
export { HieroDIDDriver } from "./methods/hiero/index.js";
export { PolygonDIDDriver } from "./methods/polygon/index.js";
// Registry
export { DIDDriverRegistry } from "./registry.js";
// Types
export type {
	DIDDocument,
	DIDDocumentMetadata,
	DIDDriverConfig,
	DIDDriverMap,
	DIDResolutionMetadata,
	DIDResolutionResult,
	DIDServiceEndpoint,
	DidUrl,
	FederationTrustInfo,
	GovernanceAwareDIDDocument,
	GovernanceMetadata,
	VerificationMethod,
} from "./types.js";
// Utilities
export {
	extractSigningKeys,
	isValidDid,
	normalizeJwk,
	parseDid,
} from "./utils.js";

// Convenience: create a registry pre-loaded with all built-in drivers.
export function createDefaultRegistry(config?: Record<string, DIDDriverConfig>): DIDDriverRegistry {
	const registry = new DIDDriverRegistry();

	if (config?.hedera) {
		registry.register(new HederaDIDDriver(config.hedera));
	}
	if (config?.hiero) {
		registry.register(new HieroDIDDriver(config.hiero));
	}
	if (config?.polygon) {
		registry.register(new PolygonDIDDriver(config.polygon));
	}

	return registry;
}
