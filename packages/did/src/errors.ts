/**
 * Errors specific to DID method operations.
 * These are NOT federation errors — they belong to the DID resolution layer.
 */

/** Base error for all DID-related failures. */
export class DIDError extends Error {
	constructor(
		message: string,
		public readonly did?: string,
	) {
		super(message);
		this.name = "DIDError";
	}
}

/** Thrown when a DID method is not supported by any registered driver. */
export class UnsupportedDIDMethodError extends DIDError {
	constructor(method: string, did?: string) {
		super(`Unsupported DID method: "${method}"`, did);
		this.name = "UnsupportedDIDMethodError";
	}
}

/** Thrown when a DID is syntactically invalid. */
export class MalformedDIDError extends DIDError {
	constructor(did: string, detail?: string) {
		super(`Malformed DID: "${did}"${detail ? ` — ${detail}` : ""}`, did);
		this.name = "MalformedDIDError";
	}
}

/** Thrown when a DID cannot be resolved (network error, not found, etc.). */
export class DIDResolutionError extends DIDError {
	constructor(
		did: string,
		public readonly underlying?: unknown,
	) {
		super(`Failed to resolve DID: "${did}"`, did);
		this.name = "DIDResolutionError";
	}
}

/** Thrown when a resolved DID document fails validation. */
export class DIDValidationError extends DIDError {
	constructor(did: string, detail: string) {
		super(`DID document validation failed for "${did}": ${detail}`, did);
		this.name = "DIDValidationError";
	}
}
