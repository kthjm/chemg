'use strict'

Object.defineProperty(exports, '__esModule', { value: true })

function _interopDefault(ex) {
  return ex && typeof ex === 'object' && 'default' in ex ? ex['default'] : ex
}

var got = _interopDefault(require('got'))
var dtz = _interopDefault(require('dtz'))
var Zip = _interopDefault(require('jszip'))

//
const throws = message => {
  throw new Error(message)
}
const asserts = (condition, message) => {
  return !condition && throws(message)
}
const joinParams = params => {
  const entries = Object.entries(params)
    .filter(
      ([key, value]) =>
        Boolean(value) ||
        typeof value === 'boolean' ||
        typeof value === 'number'
    )
    .map(([key, value]) => `${key}=${value}`)
  return entries.length ? '?' + entries.join('&') : ''
}
const toBody = ({ body }) =>
  typeof body === 'object' ? body : JSON.parse(body)

//
const oauth2_uri = 'https://accounts.google.com/o/oauth2'
const oauth2_auth_uri = `${oauth2_uri}/auth`
const oauth2_token_uri = `${oauth2_uri}/token`
const redirect_uri = 'urn:ietf:wg:oauth:2.0:oob'
const authURL = client_id => {
  asserts(client_id, `[chenv] client_id is required`)
  return (
    oauth2_auth_uri +
    joinParams({
      client_id,
      redirect_uri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/chromewebstore' // scope: 'https://www.googleapis.com/auth/chromewebstore.readonly',
    })
  )
}
const getRefreshToken = ({ client_id, client_secret, code } = {}) => {
  asserts(client_id, `[chenv] client_id is required`)
  asserts(client_secret, `[chenv] client_secret is required`)
  asserts(code, `[chenv] code is required`)
  return got(oauth2_token_uri, {
    method: 'POST',
    json: true,
    body: {
      client_id,
      client_secret,
      code,
      redirect_uri,
      grant_type: 'authorization_code'
    }
  })
    .then(toBody)
    .then(({ refresh_token }) => refresh_token)
}
const getAccessToken = ({ client_id, client_secret, refresh_token } = {}) => {
  asserts(client_id, `[chenv] client_id is required`)
  asserts(client_secret, `[chenv] client_secret is required`)
  asserts(refresh_token, `[chenv] refresh_token is required`)
  return got(oauth2_token_uri, {
    method: 'POST',
    json: true,
    body: {
      client_id,
      client_secret,
      refresh_token,
      redirect_uri,
      grant_type: 'refresh_token'
    }
  })
    .then(toBody)
    .then(({ access_token }) => access_token)
}

//
const base_uri = `https://www.googleapis.com`
const insert_uri = `${base_uri}/upload/chromewebstore/v1.1/items`

const update_uri = id => `${insert_uri}/${id}`

const check_uri = (id, projection) =>
  `${base_uri}/chromewebstore/v1.1/items/${id}${joinParams({
    projection
  })}`

const publish_uri = id => `${check_uri(id)}/publish`

const headers = access_token => {
  asserts(access_token, `[chenv] access_token is ${access_token}`)
  return {
    'x-goog-api-version': '2',
    Authorization: `Bearer ${access_token}`
  }
}

const insertItem = ({ token, body } = {}) => {
  asserts(body, `[chenv] body is ${body}`)
  return got(insert_uri, {
    method: 'POST',
    headers: headers(token),
    body
  }).then(requestHandler)
}
const updateItem = ({ token, id, body } = {}) => {
  asserts(id, `[chenv] id is ${id}`)
  asserts(body, `[chenv] body is ${body}`)
  return got(update_uri(id), {
    method: 'PUT',
    headers: headers(token),
    body
  }).then(requestHandler)
}
const publishItem = ({ token, id, target } = {}) => {
  asserts(id, `[chenv] id is ${id}`)
  asserts(target, `[chenv] target is ${target}`)
  return got(publish_uri(id), {
    method: 'POST',
    headers: headers(token),
    json: true,
    body: {
      target
    }
  }).then(requestHandler)
}
const checkItem = ({ token, id, projection } = {}) => {
  asserts(id, `[chenv] id is ${id}`)
  return got(check_uri(id, projection), {
    method: 'GET',
    headers: headers(token)
  }).then(requestHandler)
}

const requestHandler = res => {
  const body = toBody(res)
  const { uploadState, itemError } = body
  return !uploadState || uploadState === 'SUCCESS'
    ? body
    : throws(JSON.stringify(itemError || body))
}

//
const manifestMap = {
  ['remove']: {
    manifest_version: 2,
    name: '(removed)',
    version: '0'
  },
  ['create']: {
    manifest_version: 2,
    name: '',
    version: '0.0.0'
  }
}

const zipApp = async src => {
  asserts(src, `[chenv] src is ${src}`)
  const zip = await dtz(src)
  return zip.generateNodeStream()
}

const zipEmpty = manifestJson => {
  const zip = new Zip()
  zip.file('manifest.json', JSON.stringify(manifestJson))
  return zip.generateNodeStream()
}

class Chenv {
  constructor({ client_id, client_secret, refresh_token } = {}) {
    asserts(client_id, `client_id is required`)
    asserts(client_secret, `client_secret is required`)
    asserts(refresh_token, `refresh_token is required`)
    this.token = undefined
    this.credentials = {
      client_id,
      client_secret,
      refresh_token
    }
  }

  setToken() {
    return this.token
      ? false
      : getAccessToken(this.credentials).then(token => (this.token = token))
  }

  async insertItem(src) {
    await this.setToken()
    return insertItem({
      token: this.token,
      body: await zipApp(src)
    })
  }

  async updateItem(id, src) {
    await this.setToken()
    return updateItem({
      token: this.token,
      body: await zipApp(src),
      id
    })
  }

  async publishItem(id, trustedTesters) {
    await this.setToken()
    return publishItem({
      token: this.token,
      target: trustedTesters ? 'trustedTesters' : 'default',
      id
    })
  }

  async removeItem(id) {
    await this.setToken()
    return updateItem({
      token: this.token,
      body: zipEmpty(manifestMap['remove']),
      id
    })
  }

  async checkItem(id, projection) {
    await this.setToken()
    return checkItem({
      token: this.token,
      projection,
      id
    })
  }
}

exports.default = Chenv
exports.authURL = authURL
exports.getRefreshToken = getRefreshToken
exports.getAccessToken = getAccessToken
exports.insertItem = insertItem
exports.updateItem = updateItem
exports.publishItem = publishItem
exports.checkItem = checkItem
