import type QUnit from "qunit";
import type { JWK } from "../../../packages/core/src/index.js";
import {
	createDefaultRegistry,
	type DIDDocument,
	DIDDriverRegistry,
	DIDError,
	type DIDMethodDriver,
	DIDResolutionError,
	extractSigningKeys,
	HederaDIDDriver,
	HieroDIDDriver,
	isValidDid,
	MalformedDIDError,
	normalizeJwk,
	PolygonDIDDriver,
	parseDid,
	UnsupportedDIDMethodError,
	type VerificationMethod,
} from "../../../packages/did/src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal DID document with an EC publicKeyJwk in verificationMethod. */
function ecDidDoc(overrides?: Partial<DIDDocument>): DIDDocument {
	return {
		id: "did:example:123",
		verificationMethod: [
			{
				id: "did:example:123#key-1",
				type: "JsonWebKey2020",
				controller: "did:example:123",
				publicKeyJwk: {
					kty: "EC",
					crv: "P-256",
					x: "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
					y: "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
					kid: "key-1",
				},
			},
		],
		...overrides,
	} as unknown as DIDDocument;
}

/** A DID document with multiple key types and key references. */
function multiKeyDidDoc(): DIDDocument {
	return {
		id: "did:example:multi",
		verificationMethod: [
			{
				id: "did:example:multi#ec-key",
				type: "JsonWebKey2020",
				controller: "did:example:multi",
				publicKeyJwk: {
					kty: "EC",
					crv: "P-384",
					x: "gTtglUrXhG2TV3Qc3sY1Fz3Y3zCWv7J8zKX8fA6v7J8zKX8fA6v7J8zKX8fA6v",
					y: "Q9x8fA6v7J8zKX8fA6v7J8zKX8fA6v7J8zKX8fA6v7J8zKX8fA6v7J8zKX8fA6v",
					kid: "ec-key",
				},
			},
			{
				id: "did:example:multi#rsa-key",
				type: "JsonWebKey2020",
				controller: "did:example:multi",
				publicKeyJwk: {
					kty: "RSA",
					n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMs3E2vJd7s_4QmJvSRiLDMDC3aPZqF3RmB4h7m2D4j2P6qB_VdF3Wv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Qv6J1Q",
					e: "AQAB",
					kid: "rsa-key",
				},
			},
		],
		assertionMethod: ["did:example:multi#ec-key"],
		capabilityInvocation: [
			"did:example:multi#rsa-key",
			{
				id: "did:example:multi#inline-key",
				type: "JsonWebKey2020",
				controller: "did:example:multi",
				publicKeyJwk: {
					kty: "OKP",
					crv: "Ed25519",
					x: "GvXgBxgQjNTq3QxJ9vHk7t8v5s4z3w2y1x0",
					kid: "inline-key",
				},
			},
		],
		authentication: ["did:example:multi#ec-key"],
	} as unknown as DIDDocument;
}

/** A DID document where a verificationMethod entry has NO publicKeyJwk. */
function noJwkDidDoc(): DIDDocument {
	return {
		id: "did:example:no-jwk",
		verificationMethod: [
			{
				id: "did:example:no-jwk#key-1",
				type: "Ed25519VerificationKey2018",
				controller: "did:example:no-jwk",
				publicKeyMultibase: "z6Mkf5rZ3i8R9yN1Q2P3A4B5C6D7E8F9G0H1I2J3K4L5",
			},
		],
	} as unknown as DIDDocument;
}

/** A driver that does not make HTTP requests — used for registry contract tests. */
class StubDriver implements DIDMethodDriver {
	readonly name: string;
	constructor(name: string) {
		this.name = name;
	}
	method(): string {
		return this.name;
	}
	async resolve(_did: string): Promise<DIDDocument> {
		return { id: `did:${this.name}:stub` } as unknown as DIDDocument;
	}
	async validate(_did: string): Promise<boolean> {
		return true;
	}
	async getSigningKeys(_did: string): Promise<JWK[]> {
		return [];
	}
	supportsAnchoring(): boolean {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export default (QUnit: QUnit) => {
	const { module, test } = QUnit;

	// ── parseDid ──────────────────────────────────────────────────────────
	module("did / parseDid", () => {
		test("parses a valid did:hedera DID", (t) => {
			const [method, id] = parseDid("did:hedera:mainnet:0.0.12345");
			t.equal(method, "hedera", "method is hedera");
			t.equal(id, "mainnet:0.0.12345", "method-specific id is correct");
		});

		test("parses a valid did:hiero DID", (t) => {
			const [method, id] = parseDid("did:hiero:mainnet:enterprise:alice");
			t.equal(method, "hiero", "method is hiero");
			t.equal(id, "mainnet:enterprise:alice", "method-specific id is correct");
		});

		test("parses a valid did:polygon DID", (t) => {
			const [method, id] = parseDid("did:polygon:polygon-mainnet:0xContract:0xTokenId");
			t.equal(method, "polygon", "method is polygon");
			t.equal(id, "polygon-mainnet:0xContract:0xTokenId", "method-specific id is correct");
		});

		test("throws on empty string", (t) => {
			t.throws(() => parseDid(""), /non-empty string/);
		});

		test("throws on missing method", (t) => {
			t.throws(() => parseDid("invalid"), /must start with 'did:'/);
		});

		test("throws on wrong scheme", (t) => {
			t.throws(() => parseDid("foo:bar:baz"), /Invalid DID scheme/);
		});

		test("throws on empty method name", (t) => {
			t.throws(() => parseDid("did::foo"), /method name must not be empty/);
		});

		test("throws on empty method-specific id", (t) => {
			t.throws(() => parseDid("did:hedera:"), /must not be empty/);
		});
	});

	// ── isValidDid ────────────────────────────────────────────────────────
	module("did / isValidDid", () => {
		test("returns true for valid DIDs", (t) => {
			t.true(isValidDid("did:hedera:mainnet:0.0.12345"));
			t.true(isValidDid("did:hiero:testnet:enterprise:bob"));
			t.true(isValidDid("did:polygon:amoy:0xabc"));
		});

		test("returns false for invalid strings", (t) => {
			t.false(isValidDid(""));
			t.false(isValidDid("not-a-did"));
			t.false(isValidDid("did:"));
			t.false(isValidDid("did::method-specific"));
		});
	});

	// ── normalizeJwk ──────────────────────────────────────────────────────
	module("did / normalizeJwk", () => {
		test('infers kty="EC" from secp256k1 curve', (t) => {
			const result = normalizeJwk({
				crv: "secp256k1",
				x: "abcd",
				y: "ef01",
			});
			t.equal(result.kty, "EC", "kty inferred as EC");
		});

		test('infers kty="EC" from P-256 curve', (t) => {
			const result = normalizeJwk({ crv: "P-256", x: "a", y: "b" });
			t.equal(result.kty, "EC");
		});

		test('infers kty="OKP" from Ed25519 curve', (t) => {
			const result = normalizeJwk({ crv: "Ed25519", x: "abc" });
			t.equal(result.kty, "OKP");
		});

		test('infers kty="RSA" from n and e fields', (t) => {
			const result = normalizeJwk({ n: "abc123", e: "AQAB" });
			t.equal(result.kty, "RSA");
		});

		test('adds default use="sig" when missing', (t) => {
			const result = normalizeJwk({ kty: "EC", crv: "P-256", x: "a", y: "b" });
			t.equal(result.use, "sig");
		});

		test("preserves existing use field", (t) => {
			const result = normalizeJwk({ kty: "EC", crv: "P-256", x: "a", y: "b", use: "enc" });
			t.equal(result.use, "enc");
		});

		test("preserves existing kty when already set", (t) => {
			const result = normalizeJwk({ kty: "RSA", n: "abc", e: "AQAB", crv: "P-256" });
			t.equal(result.kty, "RSA", "kty unchanged");
		});
	});

	// ── extractSigningKeys ────────────────────────────────────────────────
	module("did / extractSigningKeys", () => {
		test("extracts single EC key from verificationMethod", (t) => {
			const keys = extractSigningKeys(ecDidDoc());
			t.equal(keys.length, 1, "one key extracted");
			t.equal(keys[0]?.kid, "key-1");
			t.equal(keys[0]?.kty, "EC");
		});

		test("extracts multiple keys from verificationMethod", (t) => {
			const keys = extractSigningKeys(multiKeyDidDoc());
			// 2 from verificationMethod + 1 inline from capabilityInvocation = 3
			t.equal(keys.length, 3, "three unique keys extracted");
			const kids = keys.map((k) => k.kid).sort();
			t.deepEqual(kids, ["ec-key", "inline-key", "rsa-key"]);
		});

		test("returns empty array when no publicKeyJwk present", (t) => {
			const keys = extractSigningKeys(noJwkDidDoc());
			t.equal(keys.length, 0, "no keys extracted");
		});

		test("returns empty array for empty document", (t) => {
			const keys = extractSigningKeys({
				id: "did:example:empty",
			} as unknown as DIDDocument);
			t.equal(keys.length, 0);
		});

		test("deduplicates identical JWKs", (t) => {
			const doc: DIDDocument = {
				id: "did:example:dup",
				verificationMethod: [
					{
						id: "#key-a",
						type: "JsonWebKey2020",
						controller: "did:example:dup",
						publicKeyJwk: { kty: "EC", crv: "P-256", x: "a", y: "b", kid: "dup" },
					} as unknown as VerificationMethod,
				],
				assertionMethod: [
					{
						id: "#key-b",
						type: "JsonWebKey2020",
						controller: "did:example:dup",
						publicKeyJwk: { kty: "EC", crv: "P-256", x: "a", y: "b", kid: "dup" },
					} as unknown as VerificationMethod,
				],
			};
			const keys = extractSigningKeys(doc);
			t.equal(keys.length, 1, "duplicates removed");
		});

		test("follows string references in assertionMethod", (t) => {
			const doc = multiKeyDidDoc();
			const keys = extractSigningKeys(doc);
			// ec-key should be returned (referenced by assertionMethod)
			t.true(
				keys.some((k) => k.kid === "ec-key"),
				"referenced key included",
			);
		});
	});

	// ── DIDDriverRegistry ─────────────────────────────────────────────────
	module("did / DIDDriverRegistry", () => {
		test("starts empty", (t) => {
			const r = new DIDDriverRegistry();
			t.equal(r.size, 0);
			t.deepEqual(r.methods(), []);
		});

		test("register and lookup a driver", (t) => {
			const r = new DIDDriverRegistry();
			r.register(new StubDriver("foo"));
			t.equal(r.size, 1);
			t.notEqual(r.get("foo"), undefined);
			t.equal(r.get("foo")!.method(), "foo");
		});

		test("register replaces existing driver with same method", (t) => {
			const r = new DIDDriverRegistry([new StubDriver("dup")]);
			r.register(new StubDriver("dup"));
			t.equal(r.size, 1);
		});

		test("get returns undefined for unknown method", (t) => {
			const r = new DIDDriverRegistry();
			t.equal(r.get("unknown"), undefined);
		});

		test("getOrThrow throws for unknown method", (t) => {
			const r = new DIDDriverRegistry();
			t.throws(() => r.getOrThrow("missing"), /Unsupported DID method/);
		});

		test("getForDid parses DID and returns correct driver", (t) => {
			const r = new DIDDriverRegistry([new StubDriver("alpha"), new StubDriver("beta")]);
			const driver = r.getForDid("did:alpha:123");
			t.equal(driver.method(), "alpha");
		});

		test("getForDid throws for unregistered method", (t) => {
			const r = new DIDDriverRegistry();
			t.throws(() => r.getForDid("did:ghost:123"), /Unsupported DID method/);
		});

		test("all() returns all drivers", (t) => {
			const r = new DIDDriverRegistry([new StubDriver("a"), new StubDriver("b")]);
			t.equal(r.all().length, 2);
		});

		test("unregister removes a driver", (t) => {
			const r = new DIDDriverRegistry([new StubDriver("tmp")]);
			t.true(r.unregister("tmp"));
			t.equal(r.size, 0);
		});

		test("unregister returns false for unknown method", (t) => {
			const r = new DIDDriverRegistry();
			t.false(r.unregister("nope"));
		});

		test("snapshot creates immutable copy", (t) => {
			const r = new DIDDriverRegistry([new StubDriver("a")]);
			const snap = r.snapshot();
			t.equal(snap.size, 1);
			r.register(new StubDriver("b"));
			t.equal(snap.size, 1, "snapshot unchanged after original mutation");
		});

		test("constructor accepts iterable of drivers", (t) => {
			const r = new DIDDriverRegistry([new StubDriver("x"), new StubDriver("y")]);
			t.equal(r.size, 2);
		});
	});

	// ── HederaDIDDriver ───────────────────────────────────────────────────
	module("did / HederaDIDDriver", () => {
		test("method returns 'hedera'", (t) => {
			const d = new HederaDIDDriver();
			t.equal(d.method(), "hedera");
		});

		test("supportsAnchoring returns true", (t) => {
			const d = new HederaDIDDriver();
			t.true(d.supportsAnchoring());
		});

		test("implements DIDMethodDriver interface", (t) => {
			const d: DIDMethodDriver = new HederaDIDDriver();
			t.equal(typeof d.method, "function");
			t.equal(typeof d.resolve, "function");
			t.equal(typeof d.validate, "function");
			t.equal(typeof d.getSigningKeys, "function");
			t.equal(typeof d.supportsAnchoring, "function");
		});

		test("validate returns false for malformed DID", async (t) => {
			const d = new HederaDIDDriver();
			t.false(await d.validate(""));
			t.false(await d.validate("not-a-did"));
		});

		test("resolve throws MalformedDIDError for invalid DID syntax", async (t) => {
			const d = new HederaDIDDriver();
			try {
				await d.resolve("");
				t.false(true, "should have thrown");
			} catch (e) {
				t.true(e instanceof MalformedDIDError, "MalformedDIDError thrown");
				t.true(e instanceof DIDError, "DIDError base class");
			}
		});

		test("resolve throws DIDError for non-hedera method", async (t) => {
			const d = new HederaDIDDriver();
			try {
				await d.resolve("did:polygon:123");
				t.false(true, "should have thrown");
			} catch (e) {
				t.true(e instanceof DIDError, "DIDError thrown");
			}
		});
	});

	// ── HieroDIDDriver ────────────────────────────────────────────────────
	module("did / HieroDIDDriver", () => {
		test("method returns 'hiero'", (t) => {
			const d = new HieroDIDDriver();
			t.equal(d.method(), "hiero");
		});

		test("supportsAnchoring returns true", (t) => {
			const d = new HieroDIDDriver();
			t.true(d.supportsAnchoring());
		});

		test("implements DIDMethodDriver interface", (t) => {
			const d: DIDMethodDriver = new HieroDIDDriver();
			t.equal(typeof d.method, "function");
			t.equal(typeof d.resolve, "function");
			t.equal(typeof d.validate, "function");
			t.equal(typeof d.getSigningKeys, "function");
			t.equal(typeof d.supportsAnchoring, "function");
		});

		test("validate returns false for malformed DID", async (t) => {
			const d = new HieroDIDDriver();
			t.false(await d.validate(""));
			t.false(await d.validate("did:"));
		});

		test("accepts optional config", (t) => {
			const d = new HieroDIDDriver({ network: "enterprise" });
			t.equal(d.method(), "hiero");
		});
	});

	// ── PolygonDIDDriver ──────────────────────────────────────────────────
	module("did / PolygonDIDDriver", () => {
		test("method returns 'polygon'", (t) => {
			const d = new PolygonDIDDriver();
			t.equal(d.method(), "polygon");
		});

		test("supportsAnchoring returns true", (t) => {
			const d = new PolygonDIDDriver();
			t.true(d.supportsAnchoring());
		});

		test("implements DIDMethodDriver interface", (t) => {
			const d: DIDMethodDriver = new PolygonDIDDriver();
			t.equal(typeof d.method, "function");
			t.equal(typeof d.resolve, "function");
			t.equal(typeof d.validate, "function");
			t.equal(typeof d.getSigningKeys, "function");
			t.equal(typeof d.supportsAnchoring, "function");
		});

		test("validate returns false for malformed DID", async (t) => {
			const d = new PolygonDIDDriver();
			t.false(await d.validate(""));
			t.false(await d.validate("bad"));
		});

		test("accepts optional config with rpcUrl", (t) => {
			const d = new PolygonDIDDriver({ rpcUrl: "https://custom-rpc.com" });
			t.equal(d.method(), "polygon");
		});
	});

	// ── createDefaultRegistry ─────────────────────────────────────────────
	module("did / createDefaultRegistry", () => {
		test("creates registry with all 3 drivers when config provided", (t) => {
			const r = createDefaultRegistry({
				hedera: {},
				hiero: { network: "enterprise" },
				polygon: { rpcUrl: "https://polygon-rpc.com" },
			});
			t.equal(r.size, 3, "three drivers registered");
			t.notEqual(r.get("hedera"), undefined, "hedera present");
			t.notEqual(r.get("hiero"), undefined, "hiero present");
			t.notEqual(r.get("polygon"), undefined, "polygon present");
		});

		test("creates registry with subset of drivers", (t) => {
			const r = createDefaultRegistry({
				hedera: {},
			});
			t.equal(r.size, 1, "only hedera registered");
		});

		test("creates empty registry when no config given", (t) => {
			const r = createDefaultRegistry();
			t.equal(r.size, 0, "no drivers registered");
		});
	});

	// ── Error types ───────────────────────────────────────────────────────
	module("did / errors", () => {
		test("DIDError carries the DID string", (t) => {
			const e = new DIDError("test", "did:example:123");
			t.equal(e.message, "test");
			t.equal(e.did, "did:example:123");
			t.equal(e.name, "DIDError");
		});

		test("MalformedDIDError includes detail in message", (t) => {
			const e = new MalformedDIDError("bad", "missing colon");
			t.true(e.message.includes("missing colon"));
			t.equal(e.name, "MalformedDIDError");
		});

		test("UnsupportedDIDMethodError", (t) => {
			const e = new UnsupportedDIDMethodError("foobar");
			t.true(e.message.includes("foobar"));
			t.equal(e.name, "UnsupportedDIDMethodError");
		});

		test("DIDResolutionError", (t) => {
			const cause = new Error("network failure");
			const e = new DIDResolutionError("did:example:123", cause);
			t.true(e.message.includes("did:example:123"));
			t.equal(e.underlying, cause);
			t.equal(e.name, "DIDResolutionError");
		});
	});
};
