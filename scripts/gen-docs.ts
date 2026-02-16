#!/usr/bin/env node
/**
 * @description Generate MDX API reference pages from the browser2video
 * operation registry. Output goes to website/docs/generated/api/.
 *
 * Usage:  node scripts/gen-docs.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ops,
  getOpsByCategory,
  type OpDef,
} from "../packages/browser2video/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../website/docs/generated/api");

// ---------------------------------------------------------------------------
//  Zod schema introspection helpers
// ---------------------------------------------------------------------------

/**
 * Walk a Zod schema and extract parameter info for documentation.
 * Returns an array of { name, type, required, description } objects.
 */
function extractParams(schema: any): Array<{ name: string; type: string; required: boolean; description: string }> {
  const params: Array<{ name: string; type: string; required: boolean; description: string }> = [];

  // Unwrap optionals, defaults, etc.
  let inner = schema;
  while (inner?._def) {
    if (inner._def.typeName === "ZodOptional" || inner._def.typeName === "ZodDefault") {
      inner = inner._def.innerType;
    } else {
      break;
    }
  }

  if (!inner?._def?.shape) {
    // Not an object schema — check if it's void
    if (inner?._def?.typeName === "ZodVoid" || inner?._def?.typeName === "ZodUndefined") {
      return [];
    }
    return [{ name: "(input)", type: describeZodType(schema), required: true, description: schema?._def?.description ?? "" }];
  }

  const shape = typeof inner._def.shape === "function" ? inner._def.shape() : inner._def.shape;
  for (const [key, field] of Object.entries(shape)) {
    const f = field as any;
    const isOptional = f?._def?.typeName === "ZodOptional" || f?._def?.typeName === "ZodDefault";
    const description = f?._def?.description
      ?? f?._def?.innerType?._def?.description
      ?? "";
    params.push({
      name: key,
      type: describeZodType(f),
      required: !isOptional,
      description,
    });
  }

  return params;
}

function describeZodType(schema: any): string {
  if (!schema?._def) return "unknown";
  const typeName = schema._def.typeName;

  switch (typeName) {
    case "ZodString": return "string";
    case "ZodNumber": return "number";
    case "ZodBoolean": return "boolean";
    case "ZodEnum": return schema._def.values.map((v: string) => `"${v}"`).join(" | ");
    case "ZodLiteral": return JSON.stringify(schema._def.value);
    case "ZodOptional": return describeZodType(schema._def.innerType);
    case "ZodDefault": return describeZodType(schema._def.innerType);
    case "ZodNullable": return `${describeZodType(schema._def.innerType)} | null`;
    case "ZodArray": return `${describeZodType(schema._def.type)}[]`;
    case "ZodObject": return "object";
    case "ZodUnion": return schema._def.options.map((o: any) => describeZodType(o)).join(" | ");
    case "ZodDiscriminatedUnion": return schema._def.options.map((o: any) => describeZodType(o)).join(" | ");
    case "ZodTuple": return `[${schema._def.items.map((i: any) => describeZodType(i)).join(", ")}]`;
    case "ZodVoid": return "void";
    case "ZodAny": return "any";
    case "ZodNever": return "never";
    case "ZodUndefined": return "void";
    default: return typeName?.replace("Zod", "").toLowerCase() ?? "unknown";
  }
}

// ---------------------------------------------------------------------------
//  MDX generation
// ---------------------------------------------------------------------------

const categoryTitles: Record<string, string> = {
  session: "Session",
  actor: "Actor",
  narration: "Narration",
  server: "Server",
  tool: "Tools (CLI / MCP)",
};

const categorySidebar: Record<string, number> = {
  session: 1,
  actor: 2,
  narration: 3,
  server: 4,
  tool: 5,
};

function generateCategoryPage(category: string, categoryOps: readonly OpDef[]): string {
  const title = categoryTitles[category] ?? category;
  const lines: string[] = [];

  lines.push(`---`);
  lines.push(`title: "${title} API"`);
  lines.push(`sidebar_position: ${categorySidebar[category] ?? 10}`);
  lines.push(`---`);
  lines.push(``);
  lines.push(`# ${title} API`);
  lines.push(``);

  for (const op of categoryOps) {
    const shortName = op.name.includes(".") ? op.name.split(".").pop()! : op.name;
    lines.push(`## \`${shortName}\``);
    lines.push(``);

    // Badges
    const badges: string[] = [];
    if (op.mcp) badges.push("MCP");
    if (op.cli) badges.push("CLI");
    if (badges.length) {
      lines.push(badges.map((b) => `**${b}**`).join(" · "));
      lines.push(``);
    }

    lines.push(`> ${op.summary}`);
    lines.push(``);
    lines.push(op.description);
    lines.push(``);

    // Parameters
    const params = extractParams(op.input);
    if (params.length > 0 && !(params.length === 1 && params[0].name === "(input)" && params[0].type === "void")) {
      lines.push(`### Parameters`);
      lines.push(``);
      for (const p of params) {
        const req = p.required ? "**required**" : "optional";
        lines.push(`- \`${p.name}\` (\`${p.type}\`, ${req}) — ${p.description}`);
      }
      lines.push(``);
    }

    // Examples
    if (op.examples && op.examples.length > 0) {
      lines.push(`### Examples`);
      lines.push(``);
      for (const ex of op.examples) {
        lines.push(`**${ex.title}**`);
        lines.push(``);
        lines.push("```ts");
        lines.push(ex.code);
        lines.push("```");
        lines.push(``);
      }
    }

    lines.push(`---`);
    lines.push(``);
  }

  return lines.join("\n");
}

function generateIndexPage(): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push(`title: "API Reference"`);
  lines.push(`sidebar_position: 0`);
  lines.push(`---`);
  lines.push(``);
  lines.push(`# API Reference`);
  lines.push(``);
  lines.push(`Auto-generated from the [\`browser2video\`](https://github.com/holiber/browser2video/tree/main/packages/browser2video) operation registry (${ops.length} operations).`);
  lines.push(``);

  for (const [cat, title] of Object.entries(categoryTitles)) {
    const catOps = getOpsByCategory(cat as any);
    if (catOps.length === 0) continue;
    lines.push(`## ${title}`);
    lines.push(``);
    for (const op of catOps) {
      const shortName = op.name.includes(".") ? op.name.split(".").pop()! : op.name;
      const file = cat;
      lines.push(`- [\`${shortName}\`](./${file}#${shortName.toLowerCase()}) — ${op.summary}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

function main() {
  // Clean and recreate output dir
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Generate index
  fs.writeFileSync(path.join(outDir, "index.md"), generateIndexPage());

  // Generate category pages
  for (const cat of Object.keys(categoryTitles)) {
    const catOps = getOpsByCategory(cat as any);
    if (catOps.length === 0) continue;
    const content = generateCategoryPage(cat, catOps);
    fs.writeFileSync(path.join(outDir, `${cat}.md`), content);
  }

  // Category file for Docusaurus sidebar
  fs.writeFileSync(
    path.join(outDir, "_category_.json"),
    JSON.stringify({ label: "API Reference", position: 3 }, null, 2),
  );

  console.log(`Generated ${Object.keys(categoryTitles).length + 1} files in ${outDir}`);
}

main();
