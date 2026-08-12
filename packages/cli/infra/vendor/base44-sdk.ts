// Bundle entry for the vendored SDK shipped to the Deno runtimes. The exec
// wrapper imports `npm:@base44/sdk`, which the runtime import map redirects
// here so Deno never fetches it from a registry at run time.
export * from "@base44/sdk";
