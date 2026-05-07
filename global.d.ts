declare module "*.svg" {
	const path: `${string}.svg`;
	export = path;
}

declare module "*.wasm" {
	const path: `${string}.wasm`;
	export = path;
}

declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}
