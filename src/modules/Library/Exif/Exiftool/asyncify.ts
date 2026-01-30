// NOTE: very directly this comes from asyncify.mjs in zeroperl!
// Credit where it is due: https://github.com/uswriting/zeroperl/blob/main/tools/asyncify.mjs
// written by @andrewmd5

/**
 * Copyright 2019 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Put `__asyncify_data` somewhere at the start.
// This address is pretty hand-wavy and we might want to make it configurable in future.
// See https://github.com/WebAssembly/binaryen/blob/6371cf63687c3f638b599e086ca668c04a26cbbb/src/passes/Asyncify.cpp#L106-L113
// for structure details.
const DATA_ADDR = 16;
// Place actual data right after the descriptor (which is 2 * sizeof(i32) = 8 bytes).
const DATA_START = DATA_ADDR + 8;
// End data at 1024 bytes. This is where the unused area by Clang ends and real stack / data begins.
// Because this might differ between languages and parameters passed to wasm-ld, ideally we would
// use `__stack_pointer` here, but, sadly, it's not exposed via exports yet.
const DATA_END = 1024;

const WRAPPED_EXPORTS = new WeakMap();

const State = {
	None: 0,
	Unwinding: 1,
	Rewinding: 2
};

function isPromise(
	// @ts-expect-error using an any
	obj: any
) {
	return (
		!!obj &&
		(typeof obj === 'object' || typeof obj === 'function') &&
		typeof obj.then === 'function'
	);
}

function proxyGet(
	// @ts-ignore
	obj: any,
	// @ts-ignore
	transform: any
) {
	return new Proxy(obj, {
		get: (obj, name) => transform(obj[name])
	});
}

interface WebAssemblyExports {
	asyncify_get_state: () => number;
	asyncify_stop_rewind: () => void;
	asyncify_start_unwind: (addr: number) => void;
	asyncify_stop_unwind: () => void;
	asyncify_start_rewind: (addr: number) => void;
	memory?: WebAssembly.Memory;
	[key: string]: any;
}

interface ImportObject {
	env?: {
		memory?: WebAssembly.Memory;
		[key: string]: any;
	};
	[key: string]: any;
}

class Asyncify {
	private value: unknown;
	private exports: WebAssemblyExports;

	constructor() {
		this.value = undefined;
		this.exports = {} as WebAssemblyExports;
	}

	private getState(): number {
		return this.exports.asyncify_get_state();
	}

	private assertNoneState(): void {
		const state = this.getState();
		if (state !== State.None) {
			throw new Error(`Invalid async state ${state}, expected 0.`);
		}
	}

	private wrapImportFn(fn: Function): Function {
		return (...args: unknown[]) => {
			if (this.getState() === State.Rewinding) {
				this.exports.asyncify_stop_rewind();
				return this.value;
			}
			this.assertNoneState();
			const value = fn(...args);
			if (!isPromise(value)) {
				return value;
			}
			this.exports.asyncify_start_unwind(DATA_ADDR);
			this.value = value;
		};
	}

	private wrapModuleImports(module: Record<string, unknown>): Record<string, unknown> {
		return proxyGet(module, (value: unknown) => {
			if (typeof value === 'function') {
				return this.wrapImportFn(value);
			}
			return value;
		});
	}

	wrapImports(imports?: ImportObject): ImportObject | undefined {
		if (imports === undefined) return;

		return proxyGet(imports, (moduleImports = Object.create(null)) =>
			this.wrapModuleImports(moduleImports)
		);
	}

	private wrapExportFn(fn: Function): Function {
		let newExport = WRAPPED_EXPORTS.get(fn);

		if (newExport !== undefined) {
			return newExport;
		}

		newExport = async (...args: unknown[]) => {
			this.assertNoneState();

			let result = fn(...args);

			while (this.getState() === State.Unwinding) {
				this.exports.asyncify_stop_unwind();
				this.value = await this.value;
				this.assertNoneState();
				this.exports.asyncify_start_rewind(DATA_ADDR);
				result = fn(...args);
			}

			this.assertNoneState();

			return result;
		};

		WRAPPED_EXPORTS.set(fn, newExport);

		return newExport;
	}

	wrapExports(exports: WebAssemblyExports): Record<string, unknown> {
		const newExports = Object.create(null);

		for (const exportName in exports) {
			let value = exports[exportName];
			if (typeof value === 'function' && !exportName.startsWith('asyncify_')) {
				value = this.wrapExportFn(value);
			}
			Object.defineProperty(newExports, exportName, {
				enumerable: true,
				value
			});
		}

		WRAPPED_EXPORTS.set(exports, newExports);

		return newExports;
	}

	init(instance: WebAssembly.Instance, imports?: ImportObject): void {
		const { exports } = instance;

		const memory = (exports as WebAssemblyExports).memory || (imports?.env && imports.env.memory);

		if (!memory) {
			throw new Error('Memory not found in exports or imports');
		}

		new Int32Array(memory.buffer, DATA_ADDR).set([DATA_START, DATA_END]);

		this.exports = this.wrapExports(exports as WebAssemblyExports) as WebAssemblyExports;

		Object.setPrototypeOf(instance, Instance.prototype);
	}
}

export class Instance extends WebAssembly.Instance {
	constructor(
		// @ts-ignore
		module: any,
		// @ts-ignore
		imports: any
	) {
		const state = new Asyncify();
		super(module, state.wrapImports(imports));
		state.init(this, imports);
	}

	get exports() {
		// @ts-expect-error
		return WRAPPED_EXPORTS.get(super.exports);
	}
}

Object.defineProperty(Instance.prototype, 'exports', { enumerable: true });

export async function instantiate(
	source: WebAssembly.Module | BufferSource,
	imports?: ImportObject
): Promise<WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance> {
	const state = new Asyncify();
	const result = await WebAssembly.instantiate(source, state.wrapImports(imports));
	state.init(result instanceof WebAssembly.Instance ? result : result.instance, imports);
	return result;
}

export async function instantiateStreaming(
	source: Promise<Response>,
	imports?: ImportObject
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
	const state = new Asyncify();
	const result = await WebAssembly.instantiateStreaming(source, state.wrapImports(imports));
	state.init(result.instance, imports);
	return result;
}
