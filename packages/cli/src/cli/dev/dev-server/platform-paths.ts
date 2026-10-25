// Paths the platform owns. Everything else belongs to the app's own server —
// including its server routes, which frameworks conventionally put under /api.
export const PLATFORM_PATH_PATTERN = /^\/api\/(apps|app-logs)(\/|$)/;
