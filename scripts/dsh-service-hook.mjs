/**
 * Stop channel for a Windows dsh-superagent service.
 *
 * Windows has no graceful SIGTERM, and a console control event cannot be aimed at a hidden service console reliably, so
 * `scripts/dsh-superagent` starts the DSH profile with `node --import <this file> <dsh lib/bin.js> ...` and asks it to
 * shut down over a named pipe. On request this module emits the SIGINT event DSH already handles when the operator types
 * Ctrl+C, which stops Sessions and disposes the application exactly as upstream does on POSIX.
 *
 * It is inert unless `DSH_SUPERAGENT_CONTROL_PIPE` is set, so it is harmless when the profile is booted by hand.
 */
import net from 'node:net'

const path = process.env.DSH_SUPERAGENT_CONTROL_PIPE
if (path) {
  const say = (line) => { try { process.stderr.write(`[dsh-superagent] ${line}\n`) } catch { /* the log may already be closed */ } }
  const server = net.createServer(socket => {
    let request = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => { request += chunk })
    socket.on('error', () => { /* a client that hangs up early asks for nothing */ })
    socket.on('end', () => {
      if (request.trim() !== 'stop') return
      say('stop requested; shutting down')
      socket.end('stopping\n')
      // Let the reply reach the caller before the shutdown starts disposing the process.
      setImmediate(() => {
        if (process.listenerCount('SIGINT')) process.emit('SIGINT')
        else if (process.listenerCount('SIGTERM')) process.emit('SIGTERM')
        else { say('nothing handles SIGINT; exiting'); process.exit(0) }
      })
    })
  })
  server.on('error', error => say(`control pipe unavailable: ${error.message}`))
  // Never hold the process open on this channel: DSH owns its own lifetime.
  server.unref()
  server.listen(path)
}
