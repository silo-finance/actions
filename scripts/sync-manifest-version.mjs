import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifestPath = join(root, 'public', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.version = pkg.version
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
