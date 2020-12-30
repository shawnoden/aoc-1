import keytar from 'keytar'
import inquirer from 'inquirer'
import axios from 'axios'
import path from 'path'
import cliHtml from 'cli-html'

import { AocTemplate, AocTemplateNormalized, builtinTemplates } from './templates'

export const KEYTAR_SERVICE_NAME = 'jakzo-aoc'
export const DEFAULT_ACCOUNT = '_default'
const BASE_URL = 'https://adventofcode.com'
const BACKOFF_RATE = 1.1
const BACKOFF_INITIAL = 1000
const BACKOFF_MAX = 30000

export const logHtml = html => {
  console.log(cliHtml(html).replace(/\n+$/, ''))
}

export const getCurrentDay = () => {
  const now = new Date()
  if (now.getUTCMonth() !== 11) throw new Error('Advent of Code has not started yet')
  const day = now.getUTCDate()
  if (day > 25) throw new Error('Advent of Code is over')
  return day
}

export const getCurrentYear = () => new Date().getUTCFullYear()

const isTokenValid = async (token: string) => {
  const res = await axios({
    url: BASE_URL,
    headers: { cookie: `session=${token}` },
    validateStatus: () => true,
  })
  return res.status < 300
}

export const promptForToken = async (verifyToken = false) => {
  let input = await inquirer.prompt<{ token: string }>([
    {
      name: 'token',
      message: 'Enter your session token:',
      suffix: ' (use browser dev tools and find the `session` cookie)',
      transformer: token => token.trim(),
      validate: token => (token ? true : 'Token is required'),
    },
  ])
  while (verifyToken && !(await isTokenValid(input.token))) {
    input = await inquirer.prompt<{ token: string }>([
      {
        name: 'token',
        message: 'Token invalid. Please try again:',
        transformer: token => token.trim(),
        validate: token => (token ? true : 'Token is required'),
      },
    ])
  }
  return input.token
}

export const getSessionToken = async (account = DEFAULT_ACCOUNT, verifyToken = false) => {
  const token = await keytar.getPassword(KEYTAR_SERVICE_NAME, account)
  if (token) {
    if (verifyToken && !(await isTokenValid(token))) throw new Error('token is not valid')
    return token
  }

  const inputToken = await promptForToken(verifyToken)
  await keytar.setPassword(KEYTAR_SERVICE_NAME, account, inputToken)
  return inputToken
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const padZero = (n: number, length = 2) => `${n}`.padStart(length, '0')

export const formUrlEncoded = (data: Record<string, string>) =>
  Object.entries(data)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

/** Makes a request and retries quickly on 5XX. After some time of failure it will wait longer to retry. */
export const makeRequest = async (url: string, token: string, data?: Record<string, string>) => {
  let timeOfLastRequest = 0
  let currentWait = BACKOFF_INITIAL
  while (true) {
    const timeSinceLastRequest = Date.now() - timeOfLastRequest
    if (timeSinceLastRequest < currentWait) await sleep(currentWait - timeSinceLastRequest)
    currentWait = Math.min(currentWait * BACKOFF_RATE, BACKOFF_MAX)

    let res: any
    try {
      res = await axios({
        url: `${BASE_URL}${url}`,
        method: data ? 'POST' : 'GET',
        headers: {
          ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined),
          ...(token ? { cookie: `session=${token}` } : undefined),
        },
        responseType: 'arraybuffer',
        timeout: Math.max(5000, currentWait),
        data: data ? formUrlEncoded(data) : undefined,
      })
    } catch (err) {
      console.warn(`Request failed and will retry: ${err}`)
      continue
    }

    if (res.status >= 500) {
      console.warn(`Request failed with code ${res.status}. Retrying...`)
      continue
    }
    // TODO: Prompt for session token if it's an auth error
    const responseText = res.data.toString()
    if (res.status >= 300) throw new Error(responseText)
    return responseText
  }
}

export const validateDayAndYear = (day: number, year: number) => {
  if (day < 1 || day > 25) throw new Error('day must be between 1 and 25')
  if (year < 2015) throw new Error('year must be 2015 or greater')
}

const getNextChallengeStart = () => {
  const now = new Date()
  const curYear = now.getUTCFullYear()
  const firstChallengeOfYear = new Date(Date.UTC(curYear, 11, 1, 5, 0, 0, 0))
  const lastChallengeOfYear = new Date(Date.UTC(curYear, 11, 25, 5, 0, 0, 0))
  const firstChallengeOfNextYear = new Date(Date.UTC(curYear + 1, 11, 1, 5, 0, 0, 0))
  if (now < firstChallengeOfYear) return firstChallengeOfYear
  if (now > lastChallengeOfYear) return firstChallengeOfNextYear
  return new Date(
    Date.UTC(curYear, 11, now.getUTCDate() + (now.getUTCHours() >= 5 ? 1 : 0), 5, 0, 0, 0),
  )
}

const getPrevChallengeStart = () => {
  const now = new Date()
  const curYear = now.getUTCFullYear()
  const firstChallengeOfYear = new Date(Date.UTC(curYear, 11, 1, 5, 0, 0, 0))
  const lastChallengeOfYear = new Date(Date.UTC(curYear, 11, 25, 5, 0, 0, 0))
  const lastChallengeOfLastYear = new Date(Date.UTC(curYear + 1, 11, 1, 5, 0, 0, 0))
  if (now < firstChallengeOfYear) return lastChallengeOfLastYear
  if (now > lastChallengeOfYear) return lastChallengeOfYear
  return new Date(
    Date.UTC(curYear, 11, now.getUTCDate() - (now.getUTCHours() < 5 ? 1 : 0), 5, 0, 0, 0),
  )
}

export const getCurrentChallengeStartTime = (margin = 1000 * 60 * 60 * 23) => {
  const next = getNextChallengeStart()
  const prev = getPrevChallengeStart()
  return Date.now() - prev.getTime() < margin ? prev : next
}

export const getChallengeStartTime = (year: number, day: number) =>
  new Date(Date.UTC(year, 11, day, 5, 0, 0, 0))

export const normalizeTemplate = (template: AocTemplate): AocTemplateNormalized => {
  if (typeof template === 'string') {
    if (!builtinTemplates[template]) {
      throw new Error(`built-in template '${template}' does not exist`)
    }
    return builtinTemplates[template]
  }

  return template
}

export const buildCommand = (command: string, srcPath: string) => {
  const vars = { src: path.relative(process.cwd(), srcPath) }
  return command.replace(/\{([^}]+)\}/g, (_match, _i, key) => {
    if (!vars.hasOwnProperty(key)) throw new Error(`unknown variable '${key}' in template command`)
    return vars[key]
  })
}

export const getDirForDay = (day: number) => path.resolve(padZero(day, 2))
