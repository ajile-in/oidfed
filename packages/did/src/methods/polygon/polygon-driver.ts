import type { JWK } from "@oidfed/core";
import type { DIDMethodDriver } from "../../driver.js";
import { DIDResolutionError, DIDValidationError } from "../../errors.js";
import type { DIDDocument, DIDDriverConfig } from "../../types.js";
import { extractSigningKeys, isValidDid, parseDid } from "../../utils.js";

const POLYGON_METHOD = "polygon";

const DEFAULT_NETWORK = "polygon-mainnet";

const POLYGON_RPC_ENDPOINTS: Record<string, string> = {
	"polygon-mainnet": "https://polygon-rpc.com",
	"polygon-amoy": "https://rpc-amoy.polygon.technology",
};

/**
 * DID method driver for `did:polygon` — the Polygon/EVM DID method.
 *
 * Resolves DID documents from on-chain DID registry contracts or
 * from an off-chain Universal Resolver endpoint.
 *
 * DID format: `did:polygon:{network}:{contractAddress}:{tokenId}`
 *           or `did:polygon:{network}:{address}`
 *
 * @see https://github.com/0xPolygonID/did-method
 */
export class PolygonDIDDriver implements DIDMethodDriver {
	private readonly endpoints: Record<string, string>;
	private readonly rpcUrl: string | undefined;

	constructor(config?: DIDDriverConfig) {
		this.endpoints = config?.endpoints ?? {};
		this.rpcUrl = config?.rpcUrl;
	}

	method(): string {
		return POLYGON_METHOD;
	}

	async resolve(did: string): Promise<DIDDocument> {
		const [, methodSpecificId] = this.ensureParsed(did);
		const { network, contractAddress, identifier } = this.parseAddress(methodSpecificId);

		// Try Universal Resolver first (off-chain, no RPC call)
		const doc = await this.tryUniversalResolver(did);
		if (doc) return doc;

		// Fall back to on-chain resolution via RPC
		return await this.resolveFromChain(did, network, contractAddress, identifier);
	}

	async validate(did: string): Promise<boolean> {
		if (!isValidDid(did)) return false;

		try {
			await this.resolve(did);
			return true;
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
		if (method !== POLYGON_METHOD) {
			throw new DIDValidationError(did, `Expected method "${POLYGON_METHOD}" but got "${method}"`);
		}
		return [method, id];
	}

	/**
	 * Parse `{network}:{contractAddress}:{identifier}` from the
	 * method-specific identifier.
	 */
	private parseAddress(methodSpecificId: string): {
		network: string;
		contractAddress: string;
		identifier: string;
	} {
		const parts = methodSpecificId.split(":");

		if (parts.length >= 3) {
			// polygon:{network}:{contract}:{id}
			return {
				network: parts[0] ?? DEFAULT_NETWORK,
				contractAddress: parts[1] ?? methodSpecificId,
				identifier: parts.slice(2).join(":"),
			};
		}

		if (parts.length === 2) {
			// polygon:{network}:{address}
			return {
				network: parts[0] ?? DEFAULT_NETWORK,
				contractAddress: parts[1] ?? methodSpecificId,
				identifier: "",
			};
		}

		// polygon:{address} — default to mainnet
		return {
			network: DEFAULT_NETWORK,
			contractAddress: methodSpecificId,
			identifier: "",
		};
	}

	private resolveEndpoint(network: string): string {
		return this.endpoints[network] ?? POLYGON_RPC_ENDPOINTS[network] ?? "";
	}

	private async tryUniversalResolver(did: string): Promise<DIDDocument | undefined> {
		const universalResolverUrl =
			this.endpoints["universal-resolver"] ?? "https://dev.uniresolver.io";

		try {
			const response = await fetch(
				`${universalResolverUrl}/1.0/identifiers/${encodeURIComponent(did)}`,
				{
					headers: { Accept: "application/did+json" },
				},
			);

			if (!response.ok) return undefined;

			const body = (await response.json()) as Record<string, unknown>;
			const doc = (body.didDocument ?? body) as Record<string, unknown>;

			if (doc.id) {
				return doc as unknown as DIDDocument;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Resolve a DID document by calling an EVM-compatible RPC endpoint.
	 * Uses `eth_call` against a DID registry contract.
	 *
	 * NOTE: This is a resolution abstraction only — no smart contracts are
	 * deployed or modified. The caller must provide a valid registry
	 * contract address.
	 */
	private async resolveFromChain(
		did: string,
		network: string,
		contractAddress: string,
		identifier: string,
	): Promise<DIDDocument> {
		const rpc = this.rpcUrl ?? this.resolveEndpoint(network);
		if (!rpc) {
			throw new DIDResolutionError(did, `No RPC endpoint configured for network "${network}"`);
		}

		// Build the eth_call payload to query the DID registry
		const data = this.encodeRegistryCall(contractAddress, identifier || contractAddress);

		const payload = {
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [
				{
					to: contractAddress.startsWith("0x") ? contractAddress : `0x${contractAddress}`,
					data,
				},
				"latest",
			],
		};

		let response: Response;
		try {
			response = await fetch(rpc, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
		} catch (cause) {
			throw new DIDResolutionError(did, cause);
		}

		if (!response.ok) {
			throw new DIDResolutionError(did, `RPC returned ${response.status}: ${response.statusText}`);
		}

		let json: Record<string, unknown>;
		try {
			json = (await response.json()) as Record<string, unknown>;
		} catch (cause) {
			throw new DIDResolutionError(did, `Invalid JSON RPC response: ${String(cause)}`);
		}

		if (json.error) {
			throw new DIDResolutionError(did, `RPC error: ${JSON.stringify(json.error)}`);
		}

		// Decode the hex result to a string
		const hexResult = json.result as string | undefined;
		if (!hexResult || hexResult === "0x") {
			throw new DIDResolutionError(did, "No DID document found at the given contract address");
		}

		const docJson = this.decodeHexString(hexResult);
		let doc: Record<string, unknown>;
		try {
			doc = JSON.parse(docJson) as Record<string, unknown>;
		} catch {
			throw new DIDValidationError(did, "On-chain DID document is not valid JSON");
		}

		if (!doc.id) {
			throw new DIDValidationError(did, "Resolved DID document is missing 'id' field");
		}

		return doc as unknown as DIDDocument;
	}

	/**
	 * Build an ABI-encoded `resolveDID(address)` call data.
	 * Uses the method selector `0x2b6c3f26` (keccak256("resolveDID(address)")[0:4]).
	 */
	private encodeRegistryCall(_contract: string, identity: string): string {
		// Method selector for resolveDID(address)
		const selector = "0x2b6c3f26";
		// Pad the address to 32 bytes (ABI encoding)
		const addr = identity.replace("0x", "").toLowerCase().padStart(64, "0");
		return `${selector}${addr}`;
	}

	/**
	 * Decode a hex string from an RPC response, stripping the leading
	 * "0x" and treating the rest as a UTF-8 string.
	 */
	private decodeHexString(hex: string): string {
		const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
		const bytes: number[] = [];
		for (let i = 0; i < clean.length; i += 2) {
			const byte = Number.parseInt(clean.slice(i, i + 2), 16);
			if (!Number.isNaN(byte)) {
				bytes.push(byte);
			}
		}
		return new TextDecoder().decode(new Uint8Array(bytes));
	}
}
