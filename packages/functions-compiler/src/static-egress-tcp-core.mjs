function normalizeHost(host) {
  return host.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

function destination(address) {
  const hostname = address?.hostname;
  const port = address?.port;
  if (typeof hostname !== "string" || !hostname || /[\s/@\\?#%]/.test(hostname) ||
      (hostname.startsWith("[") && !hostname.endsWith("]"))) {
    throw new TypeError("staticEgress.connect requires a hostname or IP address, not a URL");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("staticEgress.connect requires an integer port between 1 and 65535");
  }
  const authority = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  let url;
  try {
    url = new URL(`http://${authority}`);
  } catch {
    throw new TypeError("staticEgress.connect requires a valid hostname or IP address");
  }
  if (url.port || url.pathname !== "/" || !url.hostname) {
    throw new TypeError("staticEgress.connect requires hostname and port as separate fields");
  }
  return { hostname: normalizeHost(url.hostname), port };
}

function publicHost(host) {
  if (host === "localhost" || /\.(localhost|local|internal)$/.test(host)) return false;
  if (host.includes(":")) return /^[23][0-9a-f]{3}:/.test(host);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host.includes(".");
  const [a, b] = host.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)));
}

function configuredList(raw) {
  if (raw === undefined) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  throw new Error("Static egress destination restrictions are unavailable");
}

export function createStaticEgress(readEnvironment) {
  return Object.freeze({
    async connect(address, options = {}) {
      if (options === null || typeof options !== "object" || Array.isArray(options) ||
          Object.keys(options).some((key) => key !== "secureTransport") ||
          (options.secureTransport !== undefined && options.secureTransport !== "off")) {
        throw new TypeError("Static egress TCP currently supports only secureTransport: off; TLS and STARTTLS are not supported");
      }
      const target = destination(address);
      const env = readEnvironment();
      if (!env) throw new Error("Static egress TCP requires an active server request");
      if (env.BASE44_STATIC_EGRESS_ENABLED !== "1") {
        throw new Error("Workspace static egress is not enabled");
      }
      const binding = env.STATIC_EGRESS;
      if (typeof binding?.connect !== "function") {
        throw new Error("Static egress TCP binding is unavailable; rebuild and redeploy with a supported runtime");
      }
      const excluded = [
        ...configuredList(env.BASE44_STATIC_EGRESS_EXCLUDED_HOSTS),
        ...configuredList(env.BASE44_PRIVATE_DATA_SOURCES).map((entry) => entry?.host),
      ];
      if (!publicHost(target.hostname) || excluded.some((host) => {
        if (typeof host !== "string") return false;
        const normalized = normalizeHost(host);
        return normalized.startsWith(".")
          ? target.hostname === normalized.slice(1) || target.hostname.endsWith(normalized)
          : target.hostname === normalized;
      })) {
        throw new Error("Destination is not allowed through static egress TCP; use the configured private-data-source API for private services");
      }
      return binding.connect(target);
    },
  });
}
