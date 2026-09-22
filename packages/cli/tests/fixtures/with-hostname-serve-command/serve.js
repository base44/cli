// Stands in for a real dev server: reports the arguments it was handed and the
// env it was given, then stays up until the runner stops it.
const args = process.argv.slice(2).join(" ");
console.log(
  `ARGS=${args} APP=${process.env.VITE_BASE44_APP_ID} URL=${process.env.VITE_BASE44_APP_BASE_URL}`,
);
setInterval(() => {}, 1000);
