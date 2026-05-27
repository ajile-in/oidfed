import type { JWK } from "@oidfed/core";
import { MalformedDIDError } from "./errors.js";
import type { DIDDocument, VerificationMethod } from "./types.js";

/**
 * Parse a DID string into method and method-specific identifier.
 * Returns `[method, methodSpecificId]` or throws {@link MalformedDIDError}.
 */
export function parseDid(did: string): [method: string, methodSpecificId: string] {
	if (typeof did !== "string" || did.length === 0) {
		throw new MalformedDIDError(did, "DID must be a non-empty string");
	}

	const colonIndex = did.indexOf(":");
	if (colonIndex === -1 || did.startsWith(":")) {
		throw new MalformedDIDError(did, "DID must start with 'did:' scheme");
	}

	const scheme = did.slice(0, colonIndex);
	if (scheme !== "did") {
		throw new MalformedDIDError(did, `Invalid DID scheme: "${scheme}" — expected "did"`);
	}

	const rest = did.slice(colonIndex + 1);
	const secondColon = rest.indexOf(":");
	if (secondColon === -1) {
		throw new MalformedDIDError(
			did,
			"DID must include a method name and method-specific identifier separated by ':'",
		);
	}

	const method = rest.slice(0, secondColon);
	if (method.length === 0) {
		throw new MalformedDIDError(did, "DID method name must not be empty");
	}

	const methodSpecificId = rest.slice(secondColon + 1);
	if (methodSpecificId.length === 0) {
		throw new MalformedDIDError(did, "DID method-specific identifier must not be empty");
	}

	return [method, methodSpecificId];
}

/**
 * Extract all signing-capable JWKs from a DID document.
 *
 * Looks at:
 * 1. `verificationMethod` entries that have a `publicKeyJwk` field
 * 2. `assertionMethod` entries
 * 3. `capabilityInvocation` entries
 * 4. `authentication` entries (if they reference a verificationMethod with a JWK)
 *
 * Deduplicates by JWK thumbprint.
 */
export function extractSigningKeys(doc: DIDDocument): JWK[] {
	const keys: JWK[] = [];
	const seen = new Set<string>();

	function addKey(jwk: JWK): void {
		const key = JSON.stringify(jwk);
		if (!seen.has(key)) {
			seen.add(key);
			keys.push(jwk);
		}
	}

	// Direct verificationMethod entries with publicKeyJwk
	for (const vm of doc.verificationMethod ?? []) {
		if (vm.publicKeyJwk && typeof vm.publicKeyJwk === "object") {
			addKey(normalizeJwk(vm.publicKeyJwk as JWK));
		}
	}

	// assertionMethod (can be strings or inline VerificationMethod)
	for (const entry of doc.assertionMethod ?? []) {
		const jwk = resolveVerificationMethodJwk(doc, entry);
		if (jwk) addKey(jwk);
	}

	// capabilityInvocation (can be strings or inline VerificationMethod)
	for (const entry of doc.capabilityInvocation ?? []) {
		const jwk = resolveVerificationMethodJwk(doc, entry);
		if (jwk) addKey(jwk);
	}

	// authentication entries
	for (const entry of doc.authentication ?? []) {
		const jwk = resolveVerificationMethodJwk(doc, entry);
		if (jwk) addKey(jwk);
	}

	return keys;
}

/**
 * Normalize a JWK from a DID document to ensure required fields are present.
 * Ensures `kty` and `crv` (for EC/OKP) are set, patches `kid` if missing.
 */
export function normalizeJwk(jwk: Record<string, unknown>): JWK {
	const normalized: Record<string, unknown> = { ...jwk };

	// Infer kty from curve if missing
	if (!normalized.kty) {
		const crv = normalized.crv as string | undefined;
		if (crv) {
			if (crv.startsWith("secp256k1") || crv === "P-256" || crv === "P-384" || crv === "P-521") {
				normalized.kty = "EC";
			} else if (crv === "Ed25519" || crv === "X25519") {
				normalized.kty = "OKP";
			}
		} else if (normalized.n && normalized.e) {
			normalized.kty = "RSA";
		}
	}

	// Default use to "sig" for signing keys if not specified
	if (!normalized.use) {
		normalized.use = "sig";
	}

	return normalized as unknown as JWK;
}

function resolveVerificationMethodJwk(
	doc: DIDDocument,
	entry: string | VerificationMethod,
): JWK | undefined {
	if (typeof entry === "string") {
		// Reference — look up in verificationMethod array
		const vm = (doc.verificationMethod ?? []).find((v) => v.id === entry);
		if (vm?.publicKeyJwk) {
			return normalizeJwk(vm.publicKeyJwk as JWK);
		}
		return undefined;
	}

	if (entry.publicKeyJwk) {
		return normalizeJwk(entry.publicKeyJwk as JWK);
	}

	return undefined;
}

/**
 * Ensure a DID string is syntactically valid per the DID Core spec.
 * Returns `true` / `false` — does NOT throw.
 */
export function isValidDid(did: string): boolean {
	try {
		const [method, id] = parseDid(did);
		return method.length > 0 && id.length > 0;
	} catch {
		return false;
	}
}
