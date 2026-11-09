import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright')
const require = createRequire(join(runtime, 'package.json'))
const { chromium } = require('playwright')
const configPath = join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const url = process.env.CAPTURE_URL
const output = process.env.CAPTURE_DIR

if (!url || !output) {
  console.error('Set CAPTURE_URL and CAPTURE_DIR.')
  process.exit(1)
}
mkdirSync(output, { recursive: true })
if (process.platform === 'linux') {
  process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim()
}

const timed = async (label, operation) => {
  const start = Date.now()
  try {
    return await operation()
  } finally {
    console.log(`${label}: ${((Date.now() - start) / 1000).toFixed(2)}s`)
  }
}
const transient = error => Object.assign(error, { exitCode: 75 })
let browser
let exitCode = 0

try {
  browser = await timed('Browser launch', () => chromium.launch({
    ...config.browser.launchOptions,
    timeout: 30000
  }).catch(transient))

  for (const [name, width, height] of [
    ['desktop', 1280, 800],
    ['mobile', 390, 844]
  ]) {
    const page = await timed(`${name} page creation`, () => browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: name === 'mobile',
      hasTouch: name === 'mobile'
    }).catch(transient))
    page.setDefaultTimeout(20000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') console.error(`${name} console: ${message.text()}`)
    })

    const response = await timed(`${name} navigation`, () => page.goto(url, {
      waitUntil: 'load',
      timeout: 45000
    }).catch(transient))
    if (!response?.ok()) {
      const status = response?.status()
      const temporary = !response || status === 408 || status === 429 || status >= 500
      throw Object.assign(new Error(`Preview navigation failed${status ? ` (HTTP ${status})` : ''}: ${url}`), {
        exitCode: temporary ? 75 : 1
      })
    }

    await timed(`${name} render readiness`, async () => {
      await page.waitForFunction(() => {
        const game = document.querySelector('#game')
        const canvas = document.querySelector('#space')
        if (!game || !canvas || document.readyState !== 'complete') return false
        const rect = canvas.getBoundingClientRect()
        const style = getComputedStyle(game)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      }, { timeout: 20000 })
      await page.waitForTimeout(1000)
    }).catch(error => {
      if (error.name === 'TimeoutError') {
        throw Object.assign(new Error(`Game did not render on the ${name} viewport: ${error.message}`), { exitCode: 1 })
      }
      throw error
    })

    if (await page.locator('#modalBack.open').count()) {
      const briefing = page.locator('#modalTitle')
      if ((await briefing.textContent())?.trim() === 'Your story, your frontier') {
        await timed(`${name} dismiss onboarding`, () => page.locator('#modalBack.open button.action.primary').click())
      }
    }
    if (pageErrors.length) {
      throw new Error(`${name} page error: ${pageErrors.join('; ')}`)
    }
    await timed(`${name} screenshot`, () => page.screenshot({
      path: join(output, `final-${name}.png`),
      fullPage: false,
      timeout: 30000
    }).catch(error => {
      if (error.name === 'TimeoutError' || !browser.isConnected()) throw transient(error)
      throw error
    }))
    await timed(`${name} page close`, () => page.close())
    console.log(`Captured ${name} ${width}x${height} view from ${url}`)
  }
} catch (error) {
  console.error(error)
  exitCode = error.exitCode || 1
} finally {
  if (browser) {
    await timed('Browser close', () => browser.close()).catch(error => {
      console.error(error)
      exitCode ||= 75
    })
  }
}
process.exitCode = exitCode
