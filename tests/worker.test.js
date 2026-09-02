const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { webcrypto } = require('node:crypto')

function loadWorker(bindings = {}) {
  const context = vm.createContext({
    ...bindings,
    AbortController,
    Date,
    Headers,
    Intl,
    Request,
    Response,
    TextEncoder,
    URL,
    clearTimeout,
    console: { log: () => {}, error: () => {} },
    crypto: webcrypto,
    fetch,
    setTimeout,
    addEventListener: () => {},
  })
  const workerPath = path.join(__dirname, '..', 'worker.js')
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context)
  return context
}

function validBindings() {
  const bindings = Object.fromEntries([
    'SKY_UID',
    'SKY_GAME_UID',
    'SKY_GAME_SERVER',
    'API_SECRET',
    'CACHE_TTL',
    'NETEASE_TOKEN_API',
    'NETEASE_TASK_API',
    'NETEASE_EVENT_API',
    'NETEASE_TASK_ORIGIN',
    'NETEASE_TASK_REFERER',
    'NETEASE_USER_AGENT',
    'NETEASE_TOKEN_HOST',
  ].map(name => [name, 'configured']))
  bindings.SKY_GAME_SERVER = '8000'
  bindings.CACHE_TTL = '3600'
  bindings.API_SECRET = 'test-secret'
  return bindings
}

test('timingSafeEqual accepts only identical strings', async () => {
  const worker = loadWorker()
  assert.equal(await worker.timingSafeEqual('Bearer secret', 'Bearer secret'), true)
  assert.equal(await worker.timingSafeEqual('Bearer secret', 'Bearer secreu'), false)
  assert.equal(await worker.timingSafeEqual('Bearer secret', 'Bearer secret-long'), false)
})

test('getBeijingDate follows Asia/Shanghai instead of UTC', () => {
  const worker = loadWorker()
  const date = new Date('2026-09-01T16:30:00.000Z')
  assert.equal(worker.getBeijingDate(date), '2026-09-02')
})

test('getConfig rejects missing bindings and invalid cache TTL', () => {
  const bindings = validBindings()
  bindings.CACHE_TTL = '10'

  const worker = loadWorker(bindings)
  assert.throws(() => worker.getConfig(), /CACHE_TTL/)

  worker.CACHE_TTL = '3600'
  assert.equal(worker.getConfig().CACHE_TTL, 3600)
})

test('handleRequest fails closed before accessing upstream services', async () => {
  const workerWithoutConfig = loadWorker()
  const missingConfigResponse = await workerWithoutConfig.handleRequest(
    new Request('https://worker.example/', {
      headers: { Authorization: 'Bearer undefined' },
    }),
  )
  assert.equal(missingConfigResponse.status, 503)

  const worker = loadWorker(validBindings())
  const unauthorizedResponse = await worker.handleRequest(
    new Request('https://worker.example/', {
      headers: { Authorization: 'Bearer wrong-secret' },
    }),
  )
  assert.equal(unauthorizedResponse.status, 401)

  const methodResponse = await worker.handleRequest(
    new Request('https://worker.example/', { method: 'POST' }),
  )
  assert.equal(methodResponse.status, 405)
  assert.equal(methodResponse.headers.get('allow'), 'GET, OPTIONS')
})
