/**
 * Deno Function Wrapper
 *
 * This script is executed by Deno to run user functions.
 * It patches Deno.serve to inject a dynamic port before importing the user's function.
 *
 * Environment variables:
 * - FUNCTION_PATH: Absolute path to the user's function entry file
 * - FUNCTION_PORT: Port number for the function to listen on
 * - FUNCTION_NAME: Name of the function (for logging)
 */

// Make this file a module for top-level await support
export {};

const functionPath = Deno.env.get("FUNCTION_PATH");
const port = parseInt(Deno.env.get("FUNCTION_PORT") || "8000", 10);
const functionName = Deno.env.get("FUNCTION_NAME") || "unknown";

if (!functionPath) {
  console.error("[wrapper] FUNCTION_PATH environment variable is required");
  Deno.exit(1);
}

// Store the original Deno.serve
const originalServe = Deno.serve.bind(Deno);

// Patch Deno.serve to inject our port and add onListen callback
// @ts-expect-error - We're intentionally overriding Deno.serve
Deno.serve = (
  optionsOrHandler:
    | Deno.ServeOptions
    | Deno.ServeHandler
    | (Deno.ServeOptions & { handler: Deno.ServeHandler }),
  maybeHandler?: Deno.ServeHandler,
): Deno.HttpServer<Deno.NetAddr> => {
  const onListen = () => {
    // This message is used by FunctionManager to detect when the function is ready
    console.log(`[${functionName}] Listening on http://localhost:${port}`);
  };

  // Handle the different Deno.serve signatures:
  // 1. Deno.serve(handler)
  // 2. Deno.serve(options, handler)
  // 3. Deno.serve({ ...options, handler })
  if (typeof optionsOrHandler === "function") {
    // Signature: Deno.serve(handler)
    return originalServe({ port, onListen }, optionsOrHandler);
  }

  if (maybeHandler) {
    // Signature: Deno.serve(options, handler)
    return originalServe({ ...optionsOrHandler, port, onListen }, maybeHandler);
  }

  // Signature: Deno.serve({ ...options, handler })
  const options = optionsOrHandler as Deno.ServeOptions & {
    handler: Deno.ServeHandler;
  };
  return originalServe({ ...options, port, onListen });
};

console.log(`[${functionName}] Starting function from ${functionPath}`);

// Dynamically import the user's function
// The function will call Deno.serve which is now patched to use our port
try {
  await import(functionPath);
} catch (error) {
  console.error(`[${functionName}] Failed to load function:`, error);
  Deno.exit(1);
}
