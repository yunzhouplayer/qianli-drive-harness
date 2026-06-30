#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

const REPO_ROOT = findRepoRoot(process.cwd());
const GENERATOR_DIR = path.join(REPO_ROOT, "vv-automation/test-preparation/testcase-generator-web");

main().catch((error) => {
  console.error(`[generator-runpipeline] ${error.message}`);
  process.exit(2);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["text-file"] && !args.textFile) args.textFile = args["text-file"];
  if (args.help || !args.textFile || !args.out) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const text = fs.readFileSync(path.resolve(REPO_ROOT, args.textFile), "utf8");
  const artifacts = await runGeneratorPipeline(text);
  const outPath = path.resolve(REPO_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifacts, null, 2)}\n`, "utf8");

  const summary = {
    requirementUnits: artifacts.review?.requirementUnits?.length || 0,
    testPoints: artifacts.testPoints?.points?.length || 0,
    cases: artifacts.cases?.length || 0,
    p0Cases: (artifacts.cases || []).filter((item) => item.priority === "P0").length,
    releaseReadiness: artifacts.releaseReadiness?.status,
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function runGeneratorPipeline(requirementText) {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.value = "";
      this.textContent = "";
      this.innerHTML = "";
      this.files = [];
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    addEventListener() {}
  }

  const elements = new Map();
  const requirementInput = new Element();
  const requirementInputs = new Element();
  requirementInputs.children.push(requirementInput);

  [
    "#addText",
    "#fileInput",
    "#fileParseStatus",
    "#multimodalNotes",
    "#analyzeRequirements",
    "#runPipeline",
    "#exportJson",
    "#exportAssets",
    "#humanClarifications",
    "#coverageMetric",
    "#adoptionMetric",
    "#review",
    "#collaboration",
    "#llm",
    "#units",
    "#clarify",
    "#tech",
    "#points",
    "#strategy",
    "#cases",
    "#readiness",
    "#trace",
    "#artifacts",
    "#assets",
  ].forEach((selector) => elements.set(selector, new Element()));
  elements.set("#requirementInputs", requirementInputs);

  const documentStub = {
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === "#requirementInputs textarea") return requirementInputs.children;
      if (selector === ".tab" || selector === ".tab-panel" || selector === "#stepList li") return [];
      if (selector.includes("[data-clarification-input]")) return [];
      return [];
    },
    createElement() {
      return new Element();
    },
    addEventListener() {},
  };

  const sandbox = {
    document: documentStub,
    Blob,
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    Date,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(GENERATOR_DIR, "app.js"), "utf8"), sandbox);
  requirementInput.value = requirementText;
  return await vm.runInContext("runPipeline()", sandbox);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node vv-automation/harness/runtime/generator-runpipeline.mjs \\
    --text-file tmp/pdfs/prd-0330/extracted-clean.txt \\
    --out output/harness/prd-0330/generator-frontend-runpipeline-artifacts.json
`);
}

function findRepoRoot(startDir) {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    current = path.dirname(current);
  }
  return startDir;
}
