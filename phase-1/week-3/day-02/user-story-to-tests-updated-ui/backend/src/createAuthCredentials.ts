import { randomBytes, scryptSync } from 'crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { createInterface } from 'readline'
import { z } from 'zod'

const envPath = path.join(__dirname, '../../.env')

function ask(prompt: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => terminal.question(prompt, answer => {
    terminal.close()
    resolve(answer.trim())
  }))
}

function askHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run auth setup from an interactive terminal so the password can be entered without echo.')
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let value = ''

    const finish = (error?: Error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish(new Error('Auth setup cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
        } else {
          value += character
        }
      }
    }

    process.stdin.on('data', onData)
  })
}

function setEnvValues(contents: string, values: Record<string, string>): string {
  const lines = contents.split(/\r?\n/)
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex(line => new RegExp(`^\\s*${key}\\s*=`).test(line))
    const entry = `${key}=${value}`
    if (index >= 0) lines[index] = entry
    else lines.push(entry)
  }
  return `${lines.filter((line, index) => line.length > 0 || index < lines.length - 1).join('\n')}\n`
}

async function main(): Promise<void> {
  const generated = process.argv.includes('--generate')
  const emailInput = generated ? process.env.APP_AUTH_EMAIL || '' : await ask('Account email: ')
  const email = z.string().email().safeParse(emailInput)
  if (!email.success) throw new Error('Provide a valid account email address.')

  let password: string
  if (generated) {
    password = randomBytes(24).toString('base64url')
  } else {
    password = await askHidden('New password (minimum 12 characters): ')
    if (password.length < 12) throw new Error('Choose a password with at least 12 characters.')
    const confirmation = await askHidden('Confirm password: ')
    if (password !== confirmation) throw new Error('Passwords do not match.')
  }

  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  const values = {
    APP_AUTH_EMAIL: email.data.toLowerCase(),
    APP_AUTH_PASSWORD_SALT: salt.toString('hex'),
    APP_AUTH_PASSWORD_HASH: hash.toString('hex'),
    APP_AUTH_SESSION_SECRET: randomBytes(32).toString('hex')
  }

  const contents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  writeFileSync(envPath, setEnvValues(contents, values), { mode: 0o600 })
  chmodSync(envPath, 0o600)
  console.log('Sign-in credentials saved securely to the root .env file. Restart the backend to apply them.')
  if (generated) {
    console.log(`Account email: ${email.data.toLowerCase()}`)
    console.log(`Generated password: ${password}`)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Could not configure sign-in.')
  process.exitCode = 1
})
