import http from 'node:http'
import process from 'node:process'

const server = http.createServer((_request, response) => {
  response.writeHead(302, { Location: '/' })
  response.end()
})
server.listen(0, '127.0.0.1', async () => {
  let rejected = false
  try {
    await globalThis.fetch(`http://127.0.0.1:${server.address().port}/`)
  } catch (error) {
    if (!(error instanceof TypeError) || error.cause?.message !== 'redirect count exceeded') throw error
    rejected = true
  }
  if (!rejected) throw new Error('Expected the bounded local redirect probe to reject')
  process.stdout.write('LOCAL_REDIRECT_REJECTED_EXIT_REQUESTED\n')
  process.exit(0)
})
