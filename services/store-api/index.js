// Lambda Web Functions start an ordinary HTTP server on this assigned address.
// Keep the EC2 entry point unchanged; both runtimes use the same API code.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT
const separator = endpoint?.lastIndexOf(':') ?? -1
if (separator < 1 || !endpoint?.slice(separator + 1)) {
  throw new Error('AWS_LAMBDA_HTTP_ENDPOINT must contain a host and port.')
}

process.env.STORE_API_HOST = endpoint.slice(0, separator)
process.env.PORT = endpoint.slice(separator + 1)

await import('./src/server.mjs')
