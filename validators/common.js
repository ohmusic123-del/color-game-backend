function requireFields(obj, fields = []) {
  const missing = [];
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || obj[f] === "") missing.push(f);
  }
  return missing;
}

function isPositiveNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

module.exports = { requireFields, isPositiveNumber };
