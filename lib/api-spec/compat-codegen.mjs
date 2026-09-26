import { readFile, writeFile } from "node:fs/promises";

const zodApiPath = new URL("../api-zod/src/generated/api.ts", import.meta.url);
const zodTypesIndexPath = new URL("../api-zod/src/generated/types/index.ts", import.meta.url);

const zodApi = await readFile(zodApiPath, "utf8");
const zodCompatImport = `import * as zodBase from 'zod';

// Orval emits zod.int(), while this workspace intentionally stays on Zod 3.
const zod = {
  ...zodBase,
  int: () => zodBase.number().int(),
};`;

await writeFile(
  zodApiPath,
  zodApi.replace("import * as zod from 'zod';", zodCompatImport),
);

const typeIndex = await readFile(zodTypesIndexPath, "utf8");
const duplicateExports = new Set([
  "getClientMetricsParams",
  "getEquipmentMetricsParams",
  "provisionClientResponse",
]);
const filteredTypeIndex = typeIndex
  .split("\n")
  .filter((line) => {
    const match = line.match(/^export \* from '\.\/([^']+)';$/);
    return !match || !duplicateExports.has(match[1]);
  })
  .join("\n");

await writeFile(zodTypesIndexPath, filteredTypeIndex);