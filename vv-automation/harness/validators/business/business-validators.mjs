export function evaluateValidators({ validators, caseAsset, adapterResult }) {
  return validators.map(({ path, asset }) => evaluateValidator({ path, asset, caseAsset, adapterResult }));
}

function evaluateValidator({ path, asset, caseAsset, adapterResult }) {
  const ruleResults = (asset.rules || []).map((rule) => evaluateRule({ rule, caseAsset, adapterResult }));
  const failedRules = ruleResults.filter((item) => item.status !== "passed");
  return {
    validator_id: asset.id || path,
    path,
    title: asset.title || "",
    status: failedRules.length === 0 ? "passed" : "failed",
    passed_rules: ruleResults.filter((item) => item.status === "passed").map((item) => item.rule_id),
    failed_rules: failedRules.map((item) => item.rule_id),
    rule_results: ruleResults,
  };
}

function evaluateRule({ rule, caseAsset, adapterResult }) {
  const assertion = rule.assertion || {};
  let outcome;
  if (rule.type === "existence") outcome = evaluateExistence(assertion, caseAsset, adapterResult);
  else if (rule.type === "equality") outcome = evaluateEquality(assertion, adapterResult);
  else if (rule.type === "latency") outcome = evaluateLatency(assertion, adapterResult);
  else if (rule.type === "state_machine") outcome = evaluateStateMachine(assertion, adapterResult);
  else if (rule.type === "consistency") outcome = evaluateConsistency(assertion, adapterResult);
  else if (rule.type === "data_quality") outcome = evaluateDataQuality(assertion, adapterResult);
  else outcome = { passed: false, message: `Unsupported rule type: ${rule.type}` };

  return {
    rule_id: rule.id || "unnamed_rule",
    type: rule.type || "",
    status: outcome.passed ? "passed" : "failed",
    message: outcome.message,
    observed: outcome.observed,
    expected: outcome.expected,
  };
}

function evaluateExistence(assertion, caseAsset, adapterResult) {
  if (assertion.target_observation === "case.expected_result.summary") {
    const expected = caseAsset.expected_result?.summary || "";
    const observations = adapterResult.execution_result?.observations || [];
    const passed = Boolean(expected) && observations.some((item) => String(item).includes(expected));
    return { passed, observed: observations, expected, message: passed ? "Expected summary was observed." : "Expected summary was not observed." };
  }
  if (assertion.forbidden_observation) {
    const haystack = JSON.stringify(adapterResult);
    const passed = !haystack.includes(assertion.forbidden_observation);
    return { passed, observed: passed ? "absent" : "present", expected: "absent", message: passed ? "Forbidden observation is absent." : "Forbidden observation is present." };
  }
  const value = getPath(adapterResult, assertion.path || assertion.target_observation || "");
  const passed = hasValue(value);
  return { passed, observed: value, expected: "present", message: passed ? "Value is present." : "Value is missing." };
}

function evaluateEquality(assertion, adapterResult) {
  const actual = getPath(adapterResult, assertion.path || assertion.actual || "");
  const expected = assertion.expected;
  const passed = actual === expected;
  return { passed, observed: actual, expected, message: passed ? "Value matches expected." : "Value does not match expected." };
}

function evaluateLatency(assertion, adapterResult) {
  const maxLatency = Number(assertion.max_latency_seconds || 0);
  const targetStatus = String(assertion.target_observation || assertion.expected_status || "").split(".").at(-1);
  const timeline = [
    ...(adapterResult.timelines?.order_status || []),
    ...(adapterResult.timelines?.oms_order_status || []),
    ...(adapterResult.timelines?.passenger_client_status || []),
  ];
  const hit = timeline.find((item) => item.status === targetStatus);
  const observed = hit?.at_offset_seconds;
  const passed = typeof observed === "number" && observed <= maxLatency;
  return {
    passed,
    observed,
    expected: `<=${maxLatency}`,
    message: passed ? `${targetStatus} was observed within ${maxLatency}s.` : `${targetStatus} was not observed within ${maxLatency}s.`,
  };
}

function evaluateStateMachine(assertion, adapterResult) {
  const timeline = adapterResult.timelines?.order_status || [];
  if (assertion.expected_final_status) {
    const finalStatus = timeline.at(-1)?.status || adapterResult.state_snapshot?.orders?.[0]?.status;
    const passed = finalStatus === assertion.expected_final_status;
    return {
      passed,
      observed: finalStatus,
      expected: assertion.expected_final_status,
      message: passed ? "Final status matches expected state." : "Final status does not match expected state.",
    };
  }
  const forbidden = assertion.forbidden_transition || {};
  if (forbidden.from && forbidden.to) {
    const pairs = timeline.slice(1).map((item, index) => [timeline[index].status, item.status]);
    const found = pairs.some(([from, to]) => from === forbidden.from && to === forbidden.to);
    return {
      passed: !found,
      observed: pairs,
      expected: `no ${forbidden.from}->${forbidden.to}`,
      message: found ? "Forbidden transition was observed." : "Forbidden transition was not observed.",
    };
  }
  return { passed: true, message: "No state-machine assertion declared." };
}

function evaluateConsistency(assertion, adapterResult) {
  if (Array.isArray(assertion.channels)) {
    const events = adapterResult.state_snapshot?.notification_events || [];
    const missing = assertion.channels.filter((channel) => !events.some((event) => event.channel === channel && event.status === assertion.expected_status));
    const templateMissing = assertion.required_template_id === true && events.some((event) => !event.template_id);
    const passed = missing.length === 0 && !templateMissing;
    return {
      passed,
      observed: events,
      expected: assertion,
      message: passed ? "Required notification channels were delivered." : `Notification validation failed: missing=${missing.join(",") || "none"}, templateMissing=${templateMissing}`,
    };
  }
  const paths = assertion.paths || [];
  const values = paths.map((item) => getPath(adapterResult, item));
  const passed = values.length > 0 && values.every((item) => item === values[0]);
  return { passed, observed: values, expected: "all equal", message: passed ? "Values are consistent." : "Values are inconsistent." };
}

function evaluateDataQuality(assertion, adapterResult) {
  const stations = adapterResult.state_snapshot?.station_recommendations || [];
  if (assertion.entity === "station_recommendations") {
    const minCount = Number(assertion.min_count || 0);
    const maxCount = Number(assertion.max_count || Number.MAX_SAFE_INTEGER);
    const uniqueBy = assertion.unique_by || "id";
    const requiredSources = assertion.required_sources || [];
    const uniqueCount = new Set(stations.map((item) => item[uniqueBy])).size;
    const sources = new Set(stations.map((item) => item.source));
    const missingSources = requiredSources.filter((source) => !sources.has(source));
    const passed = stations.length >= minCount && stations.length <= maxCount && uniqueCount === stations.length && missingSources.length === 0;
    return {
      passed,
      observed: { count: stations.length, unique_count: uniqueCount, sources: [...sources] },
      expected: assertion,
      message: passed ? "Station recommendations satisfy quality rules." : "Station recommendations do not satisfy quality rules.",
    };
  }
  return { passed: true, observed: null, expected: assertion, message: "No data quality rule was applicable." };
}

function getPath(root, dottedPath) {
  if (!dottedPath) return undefined;
  return String(dottedPath).split(".").reduce((current, part) => {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) return current[Number(part)];
    return current[part];
  }, root);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== "";
}
