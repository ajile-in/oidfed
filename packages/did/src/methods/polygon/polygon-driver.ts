import type { JWK } from "@oidfed/core";
import type { DIDMethodDriver } from "../../driver.js";
import { DIDResolutionError, DIDValidationError } from "../../errors.js";
import type { DIDDocument, DIDDriverConfig } from "../../types.js";
import { extractSigningKeys } from "../../utils.js";

const POLYGON_METHOD = "polygon";

const POLYGON_DID_REGEX = /^did:polygon(:testnet)?:0x[0-9a-fA-F]{40}$/;

interface NetworkEntry {
	URL: string;
	CONTRACT_ADDRESS: string;
}

const networkConfig: Record<string, NetworkEntry> = {
	testnet: {
		URL: "https://rpc-amoy.polygon.technology",
		CONTRACT_ADDRESS: "0xcB80F37eDD2bE3570c6C9D5B0888614E04E1e49E",
	},
	mainnet: {
		URL: "https://polygon.drpc.org",
		CONTRACT_ADDRESS: "0x0C16958c4246271622201101C83B9F0Fc7180d15",
	},
};

function getNetworkFromDid(did: string): "testnet" | "mainnet" {
	return did.split(":")[2] === "testnet" ? "testnet" : "mainnet";
}

function getDidAddress(did: string): string {
	const parts = did.split(":");
	return parts[2] === "testnet" ? (parts[3] ?? "") : (parts[2] ?? "");
}

function validateDidFormat(did: string): boolean {
	return POLYGON_DID_REGEX.test(did);
}

// getDIDDoc(address) function selector
const GET_DID_DOC_SELECTOR = "0xb7797527";

function encodeGetDIDDoc(address: string): string {
	const addr = address.replace("0x", "").toLowerCase().padStart(64, "0");
	return `${GET_DID_DOC_SELECTOR}${addr}`;
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function readWord(data: Uint8Array, offset: number): bigint {
	let result = 0n;
	for (let i = 0; i < 32; i++) {
		result = (result << 8n) | BigInt(data[offset + i] ?? 0);
	}
	return result;
}

function readAsNumber(data: Uint8Array, offset: number): number {
	const n = readWord(data, offset);
	if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(`ABI value too large: ${n}`);
	}
	return Number(n);
}

function decodeAbiString(data: Uint8Array, baseOffset: number): string {
	const len = readAsNumber(data, baseOffset);
	const bytes = data.slice(baseOffset + 32, baseOffset + 32 + len);
	return new TextDecoder().decode(bytes);
}

function decodeGetDIDDocResult(hex: string): [string, string[]] {
	const data = hexToBytes(hex);

	// ABI-encoded tuple(string, string[]):
	//   offset_0 (32 bytes) -> string data
	//   offset_1 (32 bytes) -> string[] data
	const offset0 = readAsNumber(data, 0);
	const offset1 = readAsNumber(data, 32);

	const didDocString = decodeAbiString(data, offset0);

	// Decode string[] at offset1
	const arrLen = readAsNumber(data, offset1);
	const arrBase = offset1 + 32;
	const resources: string[] = [];
	for (let i = 0; i < arrLen; i++) {
		const elemOffset = readAsNumber(data, arrBase + i * 32);
		resources.push(decodeAbiString(data, arrBase + elemOffset));
	}

	return [didDocString, resources];
}

/**
 * DID method driver for `did:polygon` — EVM-based DID method on Polygon.
 *
 * Resolves DID documents from on-chain DID registry contracts via
 * `eth_call` against a Polygon RPC endpoint.
 *
 * DID format: `did:polygon:0x{40}` (mainnet)
 *           or `did:polygon:testnet:0x{40}` (testnet/amoy)
 *
 * @see https://github.com/ayanworks/polygon-did-modules
 */
export class PolygonDIDDriver implements DIDMethodDriver {
	private readonly rpcUrl: string | undefined;
	private readonly contractAddress: string | undefined;

	constructor(config?: DIDDriverConfig) {
		this.rpcUrl = config?.rpcUrl ?? undefined;
		this.contractAddress = (config?.contractAddress as string | undefined) ?? undefined;
	}

	method(): string {
		return POLYGON_METHOD;
	}

	async resolve(did: string): Promise<DIDDocument> {
		if (!validateDidFormat(did)) {
			throw new DIDValidationError(
				did,
				`Invalid did:polygon format — expected did:polygon[:testnet]:0x{40}`,
			);
		}

		const network = getNetworkFromDid(did);
		const didAddress = getDidAddress(did);
		const rpc = this.rpcUrl ?? networkConfig[network]?.URL;
		const contractAddr = this.contractAddress ?? networkConfig[network]?.CONTRACT_ADDRESS;

		if (!rpc) {
			throw new DIDResolutionError(did, `No RPC endpoint available for network "${network}"`);
		}
		if (!contractAddr) {
			throw new DIDResolutionError(did, `No contract address available for network "${network}"`);
		}

		const data = encodeGetDIDDoc(didAddress);

		const payload = {
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [
				{
					to: contractAddr,
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

		const hexResult = json.result as string | undefined;
		if (!hexResult || hexResult === "0x") {
			throw new DIDResolutionError(did, "No DID document found on chain");
		}

		let didDocString: string;
		try {
			didDocString = decodeGetDIDDocResult(hexResult)[0];
		} catch (cause) {
			throw new DIDValidationError(did, `Failed to decode RPC result: ${String(cause)}`);
		}

		if (!didDocString) {
			throw new DIDResolutionError(did, "No DID document found on chain");
		}

		let doc: Record<string, unknown>;
		try {
			doc = JSON.parse(didDocString) as Record<string, unknown>;
		} catch {
			throw new DIDValidationError(did, "On-chain DID document is not valid JSON");
		}

		if (!doc.id) {
			throw new DIDValidationError(did, "Resolved DID document is missing 'id' field");
		}

		return doc as unknown as DIDDocument;
	}

	async validate(did: string): Promise<boolean> {
		return validateDidFormat(did);
	}

	async getSigningKeys(did: string): Promise<JWK[]> {
		const doc = await this.resolve(did);
		return extractSigningKeys(doc);
	}

	supportsAnchoring(): boolean {
		return true;
	}
}
