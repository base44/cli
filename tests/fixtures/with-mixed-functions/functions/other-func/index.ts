export default async function main(req: Request) {
  return new Response(JSON.stringify({ message: "other-func" }));
}
