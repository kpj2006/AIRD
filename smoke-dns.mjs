import { resolveAuthorizedSigner } from "./dist/dns-authority.js";

const result = await resolveAuthorizedSigner("kpj2006.github.io");
console.log("resolveAuthorizedSigner('kpj2006.github.io'):", result);
