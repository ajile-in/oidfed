import type { JWK } from "@oidfed/core";
import type { DIDMethodDriver } from "../../driver.js";
import { DIDResolutionError, DIDValidationError } from "../../errors.js";
import type {
	DIDDocument,
	DIDDriverConfig,
	FederationTrustInfo,
	GovernanceAwareDIDDocument,
	GovernanceMetadata,
} from "../../types.js";
import { extractSigningKeys, isValidDid, parseDid } from "../../utils.js";

const HIERO_METHOD = "hiero";

const DEFAULT_NETWORK = "mainnet";

const HIERO_PERMISSIONED_GATEWAYS: Record<string, string> = {
	mainnet: "https://mainnet.hiero-did.org",
	testnet: "https://testnet.hiero-did.org",
};

/**
 * DID method driver for `did:hiero` — the LF Hyperledger Hiero DID method
 * for permissioned ledger ecosystems.
 *
 * Hiero extends the Hedera DID method with governance-aware metadata,
 * sovereign/enterprise federation support, and permissioned resolver access.
 *
 * DID format: `did:hiero:{network}:{ecosystem}:{id}`
 *
 * @see https://lf-hyperledger.atlassian.net/wiki/spaces/HIERO
 */
export class HieroDIDDriver implements DIDMethodDriver {
	private readonly endpoints: Record<string, string>;
	private readonly defaultEcosystem: string;

	constructor(config?: DIDDriverConfig) {
		this.endpoints = config?.endpoints ?? {};
		this.defaultEcosystem = (config?.network as string) ?? DEFAULT_NETWORK;
	}

	method(): string {
		return HIERO_METHOD;
	}

	async resolve(did: string): Promise<DIDDocument> {
		const [, methodSpecificId] = this.ensureParsed(did);
		const { network, ecosystem, identifier } = this.parseAddress(methodSpecificId);

		const baseUrl = this.resolveGateway(network);
		const url = `${baseUrl}/did/${ecosystem}/${identifier}`;

		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Accept: "application/did+json" },
			});
		} catch (cause) {
			throw new DIDResolutionError(did, cause);
		}

		if (!response.ok) {
			throw new DIDResolutionError(
				did,
				`Hiero gateway returned ${response.status}: ${response.statusText}`,
			);
		}

		let body: Record<string, unknown>;
		try {
			body = (await response.json()) as Record<string, unknown>;
		} catch (cause) {
			throw new DIDResolutionError(did, `Invalid JSON from Hiero gateway: ${String(cause)}`);
		}

		// Attach governance metadata if the gateway provides it as a
		// top-level envelope field.
		const doc = (body.document ?? body) as Record<string, unknown>;
		if (!doc.id) {
			throw new DIDValidationError(did, "Resolved DID document is missing 'id' field");
		}

		let governance: GovernanceMetadata | undefined;
		if (body.governance && typeof body.governance === "object") {
			governance = this.normalizeGovernance(body.governance as Record<string, unknown>, ecosystem);
		}

		if (governance) {
			(doc as GovernanceAwareDIDDocument & { governance: GovernanceMetadata }).governance =
				governance;
		}

		return doc as unknown as DIDDocument;
	}

	async validate(did: string): Promise<boolean> {
		if (!isValidDid(did)) return false;

		try {
			const [, methodSpecificId] = parseDid(did);
			const { network, ecosystem, identifier } = this.parseAddress(methodSpecificId);

			const baseUrl = this.resolveGateway(network);
			const url = `${baseUrl}/did/${ecosystem}/${identifier}`;

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
		if (method !== HIERO_METHOD) {
			throw new DIDValidationError(did, `Expected method "${HIERO_METHOD}" but got "${method}"`);
		}
		return [method, id];
	}

	/**
	 * Parse `{network}:{ecosystem}:{identifier}` from the method-specific
	 * identifier. Falls back to a default ecosystem if only two segments.
	 */
	private parseAddress(methodSpecificId: string): {
		network: string;
		ecosystem: string;
		identifier: string;
	} {
		const parts = methodSpecificId.split(":");

		if (parts.length >= 3) {
			// hiero:{network}:{ecosystem}:{id}
			return {
				network: parts[0] ?? DEFAULT_NETWORK,
				ecosystem: parts[1] ?? this.defaultEcosystem,
				identifier: parts.slice(2).join(":"),
			};
		}

		if (parts.length === 2) {
			// hiero:{network}:{id} — use default ecosystem
			return {
				network: parts[0] ?? DEFAULT_NETWORK,
				ecosystem: this.defaultEcosystem,
				identifier: parts.slice(1).join(":"),
			};
		}

		// hiero:{id} — default network and ecosystem
		return {
			network: DEFAULT_NETWORK,
			ecosystem: this.defaultEcosystem,
			identifier: methodSpecificId,
		};
	}

	private resolveGateway(network: string): string {
		return (
			this.endpoints[network] ??
			HIERO_PERMISSIONED_GATEWAYS[network] ??
			HIERO_PERMISSIONED_GATEWAYS[DEFAULT_NETWORK] ??
			"https://mainnet.hiero-did.org"
		);
	}

	private normalizeGovernance(raw: Record<string, unknown>, ecosystem: string): GovernanceMetadata {
		const federationTrust: GovernanceMetadata["federationTrust"] = Array.isArray(
			raw.federationTrust,
		)
			? (raw.federationTrust as FederationTrustInfo[])
			: undefined;

		const result: Record<string, unknown> = {
			ecosystem: (raw.ecosystem as string) ?? ecosystem,
			permissionsModel:
				(raw.permissionsModel as "permissioned" | "consortium" | "enterprise") ?? "permissioned",
		};

		if (raw.ledgerId) result.ledgerId = raw.ledgerId as string;
		if (raw.network) result.network = raw.network as string;
		if (federationTrust) result.federationTrust = federationTrust;

		return result as unknown as GovernanceMetadata;
	}
}
