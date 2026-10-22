const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')

const source = readFileSync(resolve(__dirname, '../deploy/cloudfront-storefront-spa-rewrite.js'), 'utf8')
const context = vm.createContext({})
vm.runInContext(source, context)

for (const [path, expected] of [
  ['/account/orders', '/index.html'],
  ['/account/orders/', '/index.html'],
  ['/admin/orders', '/index.html'],
  ['/admin/orders/', '/index.html'],
  ['/', '/'],
  ['/assets/index.js', '/assets/index.js'],
  ['/store-api/api/products', '/store-api/api/products'],
  ['/store-api/api/orders', '/store-api/api/orders'],
  ['/unknown', '/unknown'],
]) {
  const request = { uri: path, method: 'GET', headers: {} }
  const result = context.handler({ request })
  assert.equal(result, request)
  assert.equal(result.uri, expected, `unexpected rewrite for ${path}`)
}

console.log('Storefront CloudFront SPA route tests passed.')
