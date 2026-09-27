'use strict'

const { test } = require('node:test')
const http2 = require('node:http2')
const Fastify = require('../..')
const h2url = require('h2url')
const msg = { hello: 'world' }

test('http2 plain test', async t => {
  let fastify
  try {
    fastify = Fastify({
      http2: true
    })
    t.assert.ok(true, 'http2 successfully loaded')
  } catch (e) {
    t.assert.fail('http2 loading failed')
  }

  fastify.get('/', function (req, reply) {
    reply.code(200).send(msg)
  })

  fastify.get('/host', function (req, reply) {
    reply.code(200).send(req.host)
  })

  fastify.get('/hostname_port', function (req, reply) {
    reply.code(200).send({ hostname: req.hostname, port: req.port })
  })

  t.after(() => { fastify.close() })

  await fastify.listen({ port: 0 })

  await t.test('http get request', async (t) => {
    t.plan(3)

    const url = `http://localhost:${fastify.server.address().port}`
    const res = await h2url.concat({ url })

    t.assert.strictEqual(res.headers[':status'], 200)
    t.assert.strictEqual(res.headers['content-length'], '' + JSON.stringify(msg).length)

    t.assert.deepStrictEqual(JSON.parse(res.body), msg)
  })

  await t.test('http host', async (t) => {
    t.plan(1)

    const host = `localhost:${fastify.server.address().port}`

    const url = `http://${host}/host`
    const res = await h2url.concat({ url })

    t.assert.strictEqual(res.body, host)
  })
  await t.test('http hostname and port', async (t) => {
    t.plan(2)

    const host = `localhost:${fastify.server.address().port}`

    const url = `http://${host}/hostname_port`
    const res = await h2url.concat({ url })

    t.assert.strictEqual(JSON.parse(res.body).hostname, host.split(':')[0])
    t.assert.strictEqual(JSON.parse(res.body).port, parseInt(host.split(':')[1]))
  })
})

test('http2 response trailers do not use transfer-encoding', async t => {
  const fastify = Fastify({ http2: true })

  fastify.get('/', async (request, reply) => {
    reply.trailer('x-checksum', async () => 'abc')
    return 'hello'
  })

  await fastify.listen({ port: 0, host: '127.0.0.1' })

  const client = http2.connect(`http://127.0.0.1:${fastify.server.address().port}`)
  t.after(() => {
    client.close()
    return fastify.close()
  })

  const response = await new Promise((resolve, reject) => {
    const request = client.request({
      [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
      [http2.constants.HTTP2_HEADER_PATH]: '/'
    })
    const result = { body: '' }

    request.setEncoding('utf8')
    request.on('response', headers => {
      result.headers = headers
    })
    request.on('trailers', trailers => {
      result.trailers = trailers
    })
    request.on('data', chunk => {
      result.body += chunk
    })
    request.on('error', reject)
    request.on('end', () => resolve(result))
    request.end()
  })

  t.assert.strictEqual(response.headers[':status'], 200)
  t.assert.strictEqual(response.headers['transfer-encoding'], undefined)
  t.assert.strictEqual(response.headers.trailer, 'x-checksum')
  t.assert.strictEqual(response.body, 'hello')
  t.assert.strictEqual(response.trailers['x-checksum'], 'abc')
})
