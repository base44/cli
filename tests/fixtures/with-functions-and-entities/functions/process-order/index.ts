export default async function main(req: Request) {
  const body = await req.json();
  // Process order logic here
  return new Response(JSON.stringify({ success: true, order: body }));
}
