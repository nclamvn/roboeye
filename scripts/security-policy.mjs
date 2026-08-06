export function advisoryId(url) {
  const match = typeof url === 'string' ? url.match(/GHSA-[a-z0-9-]+/i) : null;
  return match?.[0] ?? null;
}

export function evaluateAudit(vulnerabilities, risks, today) {
  const riskById = new Map(risks.map((risk) => [risk.id, risk]));
  const observedAccepted = new Set();
  const violations = [];

  function isAllowedVulnerability(name, stack = new Set()) {
    if (stack.has(name)) return false;
    const finding = vulnerabilities[name];
    if (!finding) return false;
    if (!['high', 'critical'].includes(finding.severity)) return true;

    const nextStack = new Set(stack).add(name);
    if (!Array.isArray(finding.via) || finding.via.length === 0) return false;
    return finding.via.every((via) => {
      if (typeof via === 'string') return isAllowedVulnerability(via, nextStack);
      const id = advisoryId(via.url);
      const risk = id ? riskById.get(id) : null;
      if (!risk || risk.package !== via.name || risk.severity !== via.severity) return false;
      if (today > risk.reviewBy) {
        violations.push(`${id} đã hết hạn accepted-risk ngày ${risk.reviewBy}`);
        return false;
      }
      observedAccepted.add(id);
      return true;
    });
  }

  const unexpected = Object.keys(vulnerabilities).filter((name) => {
    const severity = vulnerabilities[name].severity;
    return ['high', 'critical'].includes(severity) && !isAllowedVulnerability(name);
  });

  return { unexpected, observedAccepted: [...observedAccepted], violations };
}

export function hasSourceSharpExposure(source) {
  return /(?:from\s+['"]sharp['"]|require\(['"]sharp['"]\)|import\(['"]sharp['"]\))/i.test(source);
}

export function hasNativeBundleExposure(source) {
  return /(?:node_modules\/sharp|@img\/sharp|VipsForeignLoad|libvips|require\(['"]sharp['"]\)|from\s+['"]sharp['"])/i.test(source);
}
