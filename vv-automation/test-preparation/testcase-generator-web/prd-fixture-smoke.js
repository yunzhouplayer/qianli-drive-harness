const fs = require("fs");
const vm = require("vm");

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
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox);

requirementInput.value = [
  "0330版本-乘客端小程序PRD\u0001",
  "产品功能清单\u0001",
  "用户登录\u0001登录页优化，登录\u0001无\u0001",
  "首页安全保障\u0001文字条幅\u0001无\u0001",
  "车辆控制\u0001座椅控制、空调\u00011. 智驾云接口\u0001",
  "功能反馈\u0001产品功能反馈\u0001无\u0001",
  "增加途经点\u0001增加途经点\u00011. 智驾云接口\u0001",
  "小程序页面分享\u00011. 小程序所有页面的分享\u0001无\u0001",
  "站点推荐\u0001下车站点推荐页面，列表的推荐（历史、热点）1.0版本\u0001",
  "行程管理\u00011. 基于目的地的增加途经点\u0001",
  "小程序Push\u00011. 消息模板（至少一个模板，先实现，后续再增加）\u0001",
  "弹窗\u00011. 弹窗\u0001",
  "短信接入\u0001接入服务商“火山云”\u0001",
].join("\n");

(async () => {
  const artifacts = await vm.runInContext("runPipeline()", sandbox);
  const goals = artifacts.review.businessGoals.map((item) => item.summary).join("\n");
  const requiredSignals = ["用户登录", "车辆控制", "增加途经点", "站点推荐", "小程序Push", "短信接入"];

  if (artifacts.review.businessGoals.length < 8) {
    throw new Error(`Expected at least 8 PRD goals, got ${artifacts.review.businessGoals.length}.`);
  }

  if (!artifacts.review.requirementUnits.every((unit) => unit.sourceTextRef)) {
    throw new Error("Expected every requirement unit to keep source text reference.");
  }

  if (artifacts.review.clarificationItems.some((item) => item.status === "resolved_by_human")) {
    throw new Error("Expected no clarification item to be resolved without human clarification input.");
  }

  if (artifacts.collaboration.agents.find((agent) => agent.id === "testing-agent")?.status !== "needs_human_review") {
    throw new Error("Expected testing-agent to request human review while P0/P1 gates are pending.");
  }

  if (artifacts.releaseReadiness.status !== "not_ready") {
    throw new Error("Expected PRD fixture to be not ready before P0/P1 human review.");
  }

  requiredSignals.forEach((signal) => {
    if (!goals.includes(signal)) {
      throw new Error(`Expected PRD goal containing ${signal}. Actual goals:\n${goals}`);
    }
  });

  if (artifacts.testPoints.points.length < 20) {
    throw new Error(`Expected at least 20 test points, got ${artifacts.testPoints.points.length}.`);
  }

  const p0Points = artifacts.testPoints.points.filter((point) => point.priority === "P0");
  const p0Cases = artifacts.cases.filter((testCase) => testCase.priority === "P0");

  if (p0Points.length < 4) {
    throw new Error(`Expected PRD high-risk functions to produce P0 points, got ${p0Points.length}.`);
  }

  if (!p0Cases.length || !p0Cases.every((testCase) => testCase.reviewStatus === "pending_human_review")) {
    throw new Error("Expected every P0 case to require human review.");
  }

  const caseText = artifacts.cases.map((testCase) => [...testCase.steps, testCase.expectedResult].join("\n")).join("\n");
  ["登录页", "座椅控制", "推荐列表", "消息订阅", "短信服务商"].forEach((signal) => {
    if (!caseText.includes(signal)) {
      throw new Error(`Expected domain-specific case content containing ${signal}.`);
    }
  });

  console.log(
    JSON.stringify(
      {
        businessGoals: artifacts.review.businessGoals.length,
        requirementUnits: artifacts.review.requirementUnits.length,
        p0Points: p0Points.length,
        p0Cases: p0Cases.length,
        collaborationAgents: artifacts.collaboration.agents.length,
        releaseReadiness: artifacts.releaseReadiness.status,
        testPoints: artifacts.testPoints.points.length,
        cases: artifacts.cases.length,
        domainSpecificSignals: 5,
        samples: artifacts.review.businessGoals.slice(0, 6).map((item) => item.summary),
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
