// Dependency-free app-profile assembly. Shared Parlor modules remain native browser ES modules.
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { siteMetadata } from './lib/site-metadata.js';
await rm("output/site", { recursive: true, force: true });
await mkdir("output/site", { recursive: true });
await cp("public", "output/site", { recursive: true });
if (process.env.APP_PROFILE === "gsb") {
  const source=siteMetadata(await readFile('public/gsb/index.html','utf8'));
  await writeFile('output/site/index.html',source);
  await writeFile('output/site/gsb/index.html',source);
}
console.log(
  `Built ${process.env.APP_PROFILE === "gsb" ? "Classmates" : "Parlor"}.`,
);
