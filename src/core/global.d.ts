declare module "*.svg" {
	const path: `${string}.svg`;
	export = path;
}

declare module "*.wasm" {
	const path: `${string}.wasm`;
	export = path;
}

declare module "*.xml" {
	const path: `${string}.xml`;
	export = path;
}

declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}

// Vite stuff
declare module '*?worker' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  export default function WorkerConstructor(options?: { name?: string }): Worker;
}

// Also for explicit .ts?worker
declare module '*.ts?worker' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  export default function WorkerConstructor(options?: { name?: string }): Worker;
}
