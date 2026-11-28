import { createHmac, scryptSync, timingSafeEqual } from 'crypto'
import express from 'express'
import { z } from 'zod'

const COOKIE_NAME = 'story_tests_session'
const SESSION_TTL_SECONDS = 8 * 60 * 60
const MAX_LOGIN_ATTEMPTS = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(1024)
})

interface AuthConfig {
  email: string
  passwordSalt: Buffer
  passwordHash: Buffer
  sessionSecret: Buffer
}

interface LoginAttempts {
  count: number
  expiresAt: number
}

const loginAttempts = new Map<string, LoginAttempts>()

function getAuthConfig(): AuthConfig | undefined {
  const email = process.env.APP_AUTH_EMAIL?.trim().toLowerCase()
  const saltHex = process.env.APP_AUTH_PASSWORD_SALT
  const hashHex = process.env.APP_AUTH_PASSWORD_HASH
  const secretHex = process.env.APP_AUTH_SESSION_SECRET

  if (
    !email ||
    !saltHex ||
    !hashHex ||
    !secretHex ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !/^[a-f0-9]{128}$/i.test(hashHex) ||
    !/^[a-f0-9]{64}$/i.test(secretHex)
  ) {
    return undefined
  }

  return {
    email,
    passwordSalt: Buffer.from(saltHex, 'hex'),
    passwordHash: Buffer.from(hashHex, 'hex'),
    sessionSecret: Buffer.from(secretHex, 'hex')
  }
}

export function isAuthConfigured(): boolean {
  return getAuthConfig() !== undefined
}

function getCookie(req: express.Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return undefined

  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=')
    if (key === name) return valueParts.join('=')
  }
  return undefined
}

function sessionSignature(config: AuthConfig, issuedAt: string): Buffer {
  return createHmac('sha256', config.sessionSecret)
    .update(`${config.email}:${issuedAt}`)
    .digest()
}

function hasValidSession(req: express.Request, config: AuthConfig): boolean {
  const cookie = getCookie(req, COOKIE_NAME)
  if (!cookie) return false

  const [issuedAt, signatureHex, extra] = cookie.split('.')
  if (
    typeof issuedAt !== 'string' ||
    typeof signatureHex !== 'string' ||
    extra !== undefined ||
    !/^\d+$/.test(issuedAt) ||
    !/^[a-f0-9]{64}$/i.test(signatureHex)
  ) {
    return false
  }

  const issuedAtSeconds = Number(issuedAt)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (issuedAtSeconds > nowSeconds || nowSeconds - issuedAtSeconds > SESSION_TTL_SECONDS) return false

  const providedSignature = Buffer.from(signatureHex, 'hex')
  const expectedSignature = sessionSignature(config, issuedAt)
  return timingSafeEqual(providedSignature, expectedSignature)
}

function cookieBaseOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api'
  }
}

function cookieOptions() {
  return {
    ...cookieBaseOptions(),
    maxAge: SESSION_TTL_SECONDS * 1000
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const attempts = loginAttempts.get(ip)
  if (!attempts || attempts.expiresAt <= now) {
    loginAttempts.delete(ip)
    return false
  }
  return attempts.count >= MAX_LOGIN_ATTEMPTS
}

function recordFailedLogin(ip: string): void {
  const now = Date.now()
  const attempts = loginAttempts.get(ip)
  if (!attempts || attempts.expiresAt <= now) {
    loginAttempts.set(ip, { count: 1, expiresAt: now + LOGIN_WINDOW_MS })
  } else {
    attempts.count += 1
  }

  if (loginAttempts.size > 10_000) {
    for (const [key, value] of loginAttempts) {
      if (value.expiresAt <= now) loginAttempts.delete(key)
    }
  }
}

export const authRouter = express.Router()

authRouter.get('/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const config = getAuthConfig()
  if (!config) {
    res.json({ configured: false, authenticated: false })
    return
  }

  const authenticated = hasValidSession(req, config)
  res.json({
    configured: true,
    authenticated,
    ...(authenticated ? { email: config.email } : {})
  })
})

authRouter.post('/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid email address and password.' })
    return
  }

  const config = getAuthConfig()
  if (!config) {
    res.status(503).json({ error: 'Sign-in is not configured. Run the backend auth setup command.' })
    return
  }

  const ip = req.ip || 'unknown'
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' })
    return
  }

  const submittedHash = scryptSync(parsed.data.password, config.passwordSalt, config.passwordHash.length)
  const passwordMatches = timingSafeEqual(submittedHash, config.passwordHash)
  const emailMatches = parsed.data.email.toLowerCase() === config.email

  if (!passwordMatches || !emailMatches) {
    recordFailedLogin(ip)
    res.status(401).json({ error: 'Email or password is incorrect.' })
    return
  }

  clearLoginAttempts(ip)
  const issuedAt = String(Math.floor(Date.now() / 1000))
  const signature = sessionSignature(config, issuedAt).toString('hex')
  res.cookie(COOKIE_NAME, `${issuedAt}.${signature}`, cookieOptions())
  res.json({ authenticated: true, email: config.email })
})

authRouter.post('/logout', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.clearCookie(COOKIE_NAME, cookieBaseOptions())
  res.json({ authenticated: false })
})

export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const config = getAuthConfig()
  if (!config) {
    res.status(503).json({ error: 'Sign-in is not configured. Run the backend auth setup command.' })
    return
  }
  if (!hasValidSession(req, config)) {
    res.status(401).json({ error: 'Sign-in required.' })
    return
  }
  next()
}
