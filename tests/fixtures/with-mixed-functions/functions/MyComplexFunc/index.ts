export default async function main(req: Request) {
  return new Response(JSON.stringify({ message: "my-complex-func" }));
}
