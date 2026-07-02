export function validateAssetContract(asset, schema, options = {}) {
  const errors = [];
  const warnings = [];
  const assetLabel = options.assetLabel || schema.schema_id || "asset";

  validateNode({
    value: asset,
    schemaNode: {
      type: "object",
      required: schema.required || [],
      fields: schema.fields || {},
    },
    path: assetLabel,
    errors,
    warnings,
  });

  return { errors, warnings };
}

function validateNode({ value, schemaNode, path, errors, warnings }) {
  const expectedType = schemaNode?.type || inferSchemaType(schemaNode);
  if (expectedType && !matchesType(value, expectedType)) {
    errors.push(`${path} must be ${expectedType}; got ${describeType(value)}.`);
    return;
  }

  if (schemaNode?.enum && hasValue(value) && !schemaNode.enum.includes(value)) {
    errors.push(`${path} must be one of [${schemaNode.enum.join(", ")}]; got ${String(value)}.`);
  }

  if (expectedType === "object") {
    validateRequiredFields(value, schemaNode.required || [], path, errors);
    for (const [field, childSchema] of Object.entries(schemaNode.fields || {})) {
      if (!hasValue(value?.[field])) continue;
      validateNode({
        value: value[field],
        schemaNode: childSchema,
        path: `${path}.${field}`,
        errors,
        warnings,
      });
    }
    return;
  }

  if (expectedType === "array") {
    if (!Array.isArray(value)) return;
    const itemSchema = schemaNode.items || {};
    value.forEach((item, index) => {
      validateNode({
        value: item,
        schemaNode: itemSchema,
        path: `${path}[${index}]`,
        errors,
        warnings,
      });
    });
  }
}

function validateRequiredFields(value, required, path, errors) {
  for (const field of required) {
    if (!hasValue(value?.[field])) errors.push(`${path}.${field} is required.`);
  }
}

function inferSchemaType(schemaNode) {
  if (!schemaNode) return "";
  if (schemaNode.fields || schemaNode.required) return "object";
  if (schemaNode.items) return "array";
  return "";
}

function matchesType(value, expectedType) {
  if (!hasValue(value)) return true;
  if (expectedType === "string") return typeof value === "string";
  if (expectedType === "integer") return Number.isInteger(value);
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  if (expectedType === "boolean") return typeof value === "boolean";
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return true;
}

function describeType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
