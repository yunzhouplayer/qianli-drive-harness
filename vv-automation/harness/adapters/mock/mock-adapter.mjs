const DEFAULT_STATIONS = [
  { id: "station_history_001", name: "历史站点-张江中心", source: "history", distance_meters: 320, region: "shanghai_test_region" },
  { id: "station_hot_001", name: "热门站点-金科路", source: "hot", distance_meters: 510, region: "shanghai_test_region" },
  { id: "station_nearby_001", name: "附近站点-祖冲之路", source: "nearby", distance_meters: 680, region: "shanghai_test_region" },
];

export async function executeMockCase({ caseAsset, fixture, runId, startedAt }) {
  const text = [
    caseAsset.title,
    caseAsset.description,
    caseAsset.expected_result?.summary,
    ...(caseAsset.steps || []).flatMap((step) => [step.name, step.action, step.expected_observation]),
    ...(caseAsset.tags || []),
  ].filter(Boolean).join("\n");

  const state = buildInitialState(fixture);
  const observations = [];
  const operationLog = [];
  const requests = [];

  for (const [index, step] of (caseAsset.steps || []).entries()) {
    operationLog.push({
      step_index: index + 1,
      name: step.name || `step_${index + 1}`,
      action: step.action || "",
      status: "passed",
      observation: step.expected_observation || "Mock adapter executed the step.",
      at_offset_seconds: index * 3,
    });
    if (step.expected_observation) observations.push(step.expected_observation);
  }

  const orderTimeline = buildOrderTimeline(text, state);
  const stationRecommendations = buildStationRecommendations(text);
  const notificationEvents = buildNotificationEvents(text);
  const vehicleCloudCommands = buildVehicleCloudCommands(text);

  if (stationRecommendations.length > 0) {
    requests.push({
      id: `${runId}-station-recommendation`,
      target: "station_recommendation_service",
      status: 200,
      response_summary: `${stationRecommendations.length} stations returned`,
    });
  }

  if (notificationEvents.length > 0) {
    for (const event of notificationEvents) {
      requests.push({
        id: `${runId}-${event.channel}`,
        target: event.channel === "sms" ? "sms_provider_mock" : "miniapp_push_mock",
        status: 200,
        response_summary: `${event.channel} delivered`,
      });
    }
  }

  const finalOrderStatus = orderTimeline.at(-1)?.status || state.orders[0]?.initial_state || "available_when_needed";
  const expectedSummary = caseAsset.expected_result?.summary || "";
  if (expectedSummary) observations.push(expectedSummary);

  return {
    adapter: {
      id: "mock-adapter.v1",
      mode: "offline",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    },
    execution_result: {
      status: "passed",
      observed_expected_result: expectedSummary,
      observations,
    },
    operation_log: operationLog,
    requests,
    state_snapshot: {
      passengers: state.passengers,
      vehicles: state.vehicles,
      orders: state.orders.map((order) => ({
        ...order,
        status: finalOrderStatus,
      })),
      station_recommendations: stationRecommendations,
      notification_events: notificationEvents,
      vehicle_cloud_commands: vehicleCloudCommands,
    },
    timelines: {
      order_status: orderTimeline,
      oms_order_status: mirrorTimeline(orderTimeline, "oms"),
      passenger_client_status: mirrorTimeline(orderTimeline, "passenger_client"),
      dispatch_event_log: orderTimeline.map((item) => ({
        event: `order_status_${item.status}`,
        status: item.status,
        at_offset_seconds: item.at_offset_seconds,
      })),
    },
    diagnostics: {
      logs: operationLog.map((item) => `[mock] ${item.name}: ${item.status}`),
      traces: [
        {
          trace_id: `${runId}-trace-001`,
          type: "mock_execution_trace",
          event_count: operationLog.length + orderTimeline.length,
        },
      ],
      requests,
      state_snapshots: ["state_snapshot"],
    },
  };
}

function buildInitialState(fixture) {
  const entities = fixture.entities || [];
  const byType = (type) => entities
    .filter((item) => item.type === type)
    .map((item) => ({ id: item.id, initial_state: item.initial_state || "unknown" }));
  return {
    passengers: byType("passenger"),
    vehicles: byType("vehicle"),
    orders: byType("order"),
  };
}

function buildOrderTimeline(text, state) {
  const initialStatus = state.orders[0]?.initial_state || (/(下单|叫车|订单)/.test(text) ? "CREATED" : "available_when_needed");
  const shouldArrive = /(到站|到达|ARRIVED|接驾|状态同步)/i.test(text);
  const shouldComplete = /(完成|支付|结算|COMPLETED)/i.test(text);

  const timeline = [{ status: normalizeOrderStatus(initialStatus), at_offset_seconds: 0 }];
  if (shouldArrive) timeline.push({ event: "vehicle_arrived_pickup_point", status: "ARRIVED", at_offset_seconds: 12 });
  if (shouldComplete) timeline.push({ event: "trip_completed", status: "COMPLETED", at_offset_seconds: shouldArrive ? 48 : 20 });
  if (timeline.length === 1 && /(订单|状态)/.test(text)) timeline.push({ event: "mock_order_ready", status: "PICKING_UP", at_offset_seconds: 6 });
  return dedupeAdjacentStatuses(timeline);
}

function buildStationRecommendations(text) {
  if (!/(站点|推荐|历史|热门|附近|跨区域)/.test(text)) return [];
  return DEFAULT_STATIONS.map((station, index) => ({
    ...station,
    rank: index + 1,
    available: true,
  }));
}

function buildNotificationEvents(text) {
  if (!/(短信|Push|push|订阅|消息|模板|通知)/.test(text)) return [];
  return [
    {
      id: "notify_sms_001",
      channel: "sms",
      template_id: "SMS_TEMPLATE_MOCK_001",
      trigger_event: "order_status_changed",
      status: "delivered",
      delivered_at_offset_seconds: 3,
      provider_message_id: "mock-message-sms-001",
    },
    {
      id: "notify_push_001",
      channel: "miniapp_push",
      template_id: "MINIAPP_TEMPLATE_MOCK_001",
      trigger_event: "order_status_changed",
      status: "delivered",
      delivered_at_offset_seconds: 2,
      provider_message_id: "mock-message-push-001",
    },
  ];
}

function buildVehicleCloudCommands(text) {
  if (!/(车控|车辆控制|空调|座椅|车门|解锁)/.test(text)) return [];
  return [
    {
      id: "vehicle_command_001",
      command: /座椅/.test(text) ? "seat_control" : "climate_control",
      cloud_status: "accepted",
      vehicle_status: "applied",
      user_feedback: "success",
      latency_seconds: 2,
    },
  ];
}

function mirrorTimeline(timeline, source) {
  return timeline.map((item) => ({
    source,
    status: item.status,
    event: item.event || "status_snapshot",
    at_offset_seconds: item.at_offset_seconds,
  }));
}

function normalizeOrderStatus(status) {
  const text = String(status || "").toUpperCase();
  if (text === "REGISTERED" || text === "AVAILABLE_WHEN_NEEDED") return "CREATED";
  return text;
}

function dedupeAdjacentStatuses(timeline) {
  return timeline.filter((item, index) => index === 0 || item.status !== timeline[index - 1].status);
}
