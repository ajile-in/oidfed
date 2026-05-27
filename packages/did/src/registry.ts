import type { DIDMethodDriver } from "./driver.js";
import { UnsupportedDIDMethodError } from "./errors.js";
import type { DIDDriverMap } from "./types.js";
import { parseDid } from "./utils.js";

/**
 * Registry of DID method drivers.
 *
 * Drivers are keyed by method name (e.g. `"hedera"`, `"hiero"`, `"polygon"`).
 * Lookup is O(1).
 */
export class DIDDriverRegistry {
	private readonly drivers = new Map<string, DIDMethodDriver>();

	constructor(drivers?: DIDMethodDriver[]) {
		if (drivers) {
			for (const driver of drivers) {
				this.register(driver);
			}
		}
	}

	/** Register a DID method driver. Replaces any existing driver for the same method. */
	register(driver: DIDMethodDriver): this {
		this.drivers.set(driver.method(), driver);
		return this;
	}

	/** Unregister a DID method driver by method name. */
	unregister(method: string): boolean {
		return this.drivers.delete(method);
	}

	/** Look up a driver by method name. */
	get(method: string): DIDMethodDriver | undefined {
		return this.drivers.get(method);
	}

	/** Look up a driver by method name. Throws if not found. */
	getOrThrow(method: string): DIDMethodDriver {
		const driver = this.drivers.get(method);
		if (!driver) {
			throw new UnsupportedDIDMethodError(method);
		}
		return driver;
	}

	/** Look up a driver for a given DID string by parsing its method. */
	getForDid(did: string): DIDMethodDriver {
		const [method] = parseDid(did);
		return this.getOrThrow(method);
	}

	/** Get all registered method names. */
	methods(): string[] {
		return [...this.drivers.keys()];
	}

	/** Get all registered drivers. */
	all(): DIDMethodDriver[] {
		return [...this.drivers.values()];
	}

	/** Create an immutable snapshot of the current registry. */
	snapshot(): DIDDriverMap {
		return new Map(this.drivers);
	}

	/** Number of registered drivers. */
	get size(): number {
		return this.drivers.size;
	}
}
