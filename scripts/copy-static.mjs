import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDir = resolve(process.cwd(), "src", "nodes");
const targetDir = resolve(process.cwd(), "dist", "nodes");

await mkdir(targetDir, { recursive: true });
await cp(resolve(sourceDir, "telegram-api.html"), resolve(targetDir, "telegram-api.html"));
