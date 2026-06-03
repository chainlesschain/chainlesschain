import { build } from 'vitepress'

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err.message)
  process.exit(1)
})

try {
  console.log('Starting build...')
  await build('./docs')
  console.log('Build complete!')
} catch(e) {
  console.error('Build error:', e.message)
  process.exit(1)
}
