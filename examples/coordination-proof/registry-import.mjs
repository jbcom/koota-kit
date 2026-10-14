// Copy beside the private consumer package.json so all imports resolve from its registry install.
export const registryImport = (specifier) => import(specifier);
export const registryResolve = (specifier) => import.meta.resolve(specifier);
