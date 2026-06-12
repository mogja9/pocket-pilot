// Let the browser build (Vite) and tsc import the vendored card JSON without
// inferring its full literal type (which would be huge/slow).
declare module '*.json' {
  const value: unknown;
  export default value;
}
