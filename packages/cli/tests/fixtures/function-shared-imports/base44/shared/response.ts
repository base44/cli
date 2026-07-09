export const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
export const err = (msg: string) => new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
