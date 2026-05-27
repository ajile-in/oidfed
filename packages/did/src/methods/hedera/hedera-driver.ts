import type { JWK } from "@oidfed/core";
import type { DIDMethodDriver } from "../../driver.js";
import { DIDResolutionError, DIDValidationError } from "../../errors.js";
import type { DIDDocument, DIDDriverConfig } from "../../types.js";
import { extractSigningKeys, isValidDid, parseDid } from "../../utils.js";

const HEDERA_METHOD = "hedera";

const DEFAULT_NETWORK = "mainnet";

const HEDERA_MIRROR_NODES: Record<string, string> = {
	mainnet: "https://mainnet-public.mirrornode.hedera.com",
	testnet: "https://testnet.mirrornode.hedera.com",
	previewnet: "https://previewnet.mirrornode.hedera.com",
};

/**
 * DID method driver for `did:hedera` — the Hedera DID method.
 *
 * Uses the Hedera mirror node REST API to resolve DID documents
 * that were published via the Hedera Consensus Service (HCS).
 *
 * DID format: `did:hedera:{network}:{id}`
 *
 * @see https://github.com/hashgraph/did-method
 */
export class HederaDIDDriver implements DIDMethodDriver {
	private readonly endpoints: Record<string, string>;

	constructor(config?: DIDDriverConfig) {
		this.endpoints = config?.endpoints ?? {};
	}

	method(): string {
		return HEDERA_METHOD;
	}

	async resolve(did: string): Promise<DIDDocument> {
		const [, methodSpecificId] = this.ensureParsed(did);
		const { network, address } = this.parseAddress(methodSpecificId);

		const baseUrl = this.resolveMirrorNode(network);
		const url = `${baseUrl}/api/v1/accounts/${address}/did`;

		let response: Response;
		try {
			response = await fetch(url);
		} catch (cause) {
			throw new DIDResolutionError(did, cause);
		}

		if (!response.ok) {
			throw new DIDResolutionError(
				did,
				`Mirror node returned ${response.status}: ${response.statusText}`,
			);
		}

		let body: Record<string, unknown>;
		try {
			body = (await response.json()) as Record<string, unknown>;
		} catch (cause) {
			throw new DIDResolutionError(did, `Invalid JSON from mirror node: ${String(cause)}`);
		}

		// The mirror node returns a DID document directly or wraps it
		// in a envelope. Handle both.
		const rawDoc = (body.document ?? body) as Record<string, unknown>;
		if (!rawDoc.id) {
			throw new DIDValidationError(did, "Resolved DID document is missing 'id' field");
		}

		return rawDoc as unknown as DIDDocument;
	}

	async validate(did: string): Promise<boolean> {
		if (!isValidDid(did)) return false;

		try {
			const [, methodSpecificId] = parseDid(did);
			const { network, address } = this.parseAddress(methodSpecificId);

			const baseUrl = this.resolveMirrorNode(network);
			const url = `${baseUrl}/api/v1/accounts/${address}/did`;

			const response = await fetch(url, { method: "HEAD" });
			return response.ok;
		} catch {
			return false;
		}
	}

	async getSigningKeys(did: string): Promise<JWK[]> {
		const doc = await this.resolve(did);
		return extractSigningKeys(doc);
	}

	supportsAnchoring(): boolean {
		return true;
	}

	private ensureParsed(did: string): [string, string] {
		const [method, id] = parseDid(did);
		if (method !== HEDERA_METHOD) {
			throw new DIDValidationError(did, `Expected method "${HEDERA_METHOD}" but got "${method}"`);
		}
		return [method, id];
	}

	/**
	 * Parse `{network}:{address}` from the method-specific identifier.
	 * Defaults to `mainnet` if no network prefix is present.
	 */
	private parseAddress(methodSpecificId: string): { network: string; address: string } {
		const parts = methodSpecificId.split(":");
		if (parts.length >= 2) {
			// Format: hedera:{network}:{address}
			return {
				network: parts[0] ?? DEFAULT_NETWORK,
				address: parts.slice(1).join(":"),
			};
		}
		// Format: hedera:{address} — default to mainnet
		return {
			network: DEFAULT_NETWORK,
			address: methodSpecificId,
		};
	}

	private resolveMirrorNode(network: string): string {
		return (
			this.endpoints[network] ??
			HEDERA_MIRROR_NODES[network] ??
			HEDERA_MIRROR_NODES[DEFAULT_NETWORK] ??
			"https://mainnet-public.mirrornode.hedera.com"
		);
	}
}
