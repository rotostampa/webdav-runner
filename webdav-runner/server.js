import { v2 as webdav } from "webdav-server"
import express from "express"

import {
  expand_path,
  read_file,
  ensure_dir,
  write_json,
  startswith,
} from "../webdav-runner/utils.js"
import default_config from "../webdav-runner/config.js"

import fs from "fs"
// var pem = require('pem')
// pem.createCertificate({ days: 1, selfSigned: true }, function (err, keys) {
//   { key: keys.serviceKey, cert: keys.certificate }
// })
import { execFile } from "node:child_process"
import Bonjour from "bonjour"
import { v4 as uuidv4 } from "uuid"

//    'all'
//    | 'canCreate'
//    | 'canDelete'
//    | 'canMove'
//    | 'canRename'
//    | 'canAppend'
//    | 'canWrite'
//    | 'canRead'
//    | 'canSource'
//    | 'canGetMimeType'
//    | 'canGetSize'
//    | 'canListLocks'
//    | 'canSetLock'
//    | 'canRemoveLock'
//    | 'canGetAvailableLocks'
//    | 'canGetLock'
//    | 'canAddChild'
//    | 'canRemoveChild'
//    | 'canGetChildren'
//    | 'canSetProperty'
//    | 'canGetProperty'
//    | 'canGetProperties'
//    | 'canRemoveProperty'
//    | 'canGetCreationDate'
//    | 'canGetLastModifiedDate'
//    | 'canGetWebName'
//    | 'canGetType';

const READ_WRITE = ["all"]
const READ_ONLY = [
  "canRead",
  "canSource",
  "canGetMimeType",
  "canGetSize",
  "canListLocks",
  "canGetAvailableLocks",
  "canGetLock",
  "canGetChildren",
  "canGetProperty",
  "canGetProperties",
  "canGetCreationDate",
  "canGetLastModifiedDate",
  "canGetWebName",
  "canGetType",
]

function get_config(config, ...args) {
  for (const current of [config, default_config]) {
    let result = current

    loop: for (const key of args) {
      if (result && result[key]) {
        result = result[key]
      } else {
        result = null
        break loop
      }
    }

    if (result) {
      return result
    }
  }
}

function set_file_system(
  name,
  path,
  permission,
  { server, user, privilege_manager }
) {
  console.log("mounting fs", name, path)

  server.setFileSystem(name, new webdav.PhysicalFileSystem(path))

  privilege_manager.setRights(user, name, permission)
}

const filenames = {}

function execute_file(loc) {
  const file = expand_path(loc)

  if (!filenames[file]) {
    filenames[file] = file

    execFile("/bin/bash", [file], (error, stdout, stderr) => {
      if (error) {
        console.log("error", file, error)
      }
      console.log("stdout", file, stdout)
      console.log("stderr", file, stderr)

      if (fs.existsSync(file)) {
        fs.rmSync(file)
      }

      delete filenames[file]
    })
  }
}

const services = {
  readwrite: ({ name, path }, context) => {
    set_file_system(`/${name}`, path, READ_WRITE, context)
  },
  read: ({ name, path }, context) => {
    set_file_system(`/${name}`, path, READ_ONLY, context)
  },
  commands: ({ name, path }, context) => {
    set_file_system(`/${name}`, path, READ_WRITE, context)

    fs.watch(path, (eventType, filename) => {
      console.log("changed", eventType, filename)

      if (!startswith(filename, ".")) {
        execute_file([path, filename])
      }
    })
  },
  bonjour: ({ name, path }, context) => {
    set_file_system(`/${name}`, path, READ_ONLY, context)
    Bonjour().find(
      { type: get_config(context.config, "bonjour", "type") },
      e => {
        delete e.rawText
        write_json([path, `${e.name}.json`], e)
      }
    )
  },
}

function bonjour(config) {
  const settings = {
    name: get_config(config, "bonjour", "name") || uuidv4(),
    type: get_config(config, "bonjour", "type"),
    port: get_config(config, "bonjour", "port"),
  }

  console.log("starting bonjour using", settings)

  Bonjour().publish(settings)
}

export default config => {
  bonjour(config)

  // bonjour.find({ type: get_config(config, 'bonjour', 'type') }, e => console.log('up', e))

  const user_manager = new webdav.SimpleUserManager()
  const user = user_manager.addUser(
    get_config(config, "webdav", "username"),
    get_config(config, "webdav", "password"),
    false
  )

  const privilege_manager = new webdav.SimplePathPrivilegeManager()

  const temp = ensure_dir(["../temp", uuidv4()])

  privilege_manager.setRights(user, "/", READ_ONLY)

  const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPBasicAuthentication(
      user_manager,
      "realm"
    ),
    privilegeManager: privilege_manager,
    port: get_config(config, "webdav", "port"),
    hostname: get_config(config, "webdav", "hostname"),
    withCredentials: true,
    https: {
      key: read_file(get_config(config, "webdav", "ssl_key")),
      cert: read_file(get_config(config, "webdav", "ssl_cert")),
    },
    maxRequestDepth: Infinity,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "HEAD, GET, PUT, PROPFIND, DELETE, OPTIONS, MKCOL, MOVE, COPY",
      "Access-Control-Allow-Headers":
        "Accept, Authorization, Content-Type, Content-Length, Depth",
    },
  })

  server.afterRequest((arg, next) => {
    // Display the method, the URI, the returned status code and the returned message
    console.log(
      ">>",
      arg.request.method,
      arg.requested.uri,
      ">",
      arg.response.statusCode,
      arg.response.statusMessage
    )
    // If available, display the body of the response
    //console.log(arg.responseBody);
    next()
  })

  const folders = get_config(config, "folders")
  const context = {
    server,
    user,
    privilege_manager,
    config,
  }

  for (const [name, settings] of Object.entries(folders)) {
    if (!settings.name) {
      settings.name = name
    }
    if (!settings.type) {
      settings.type = 'read'
    }
    if (!settings.tags) {
      settings.tags = [settings.type]
    }

    settings.path = settings.path
      ? expand_path(settings.path)
      : ensure_dir([temp, uuidv4()])

    services[settings.type](settings, context)

    delete settings.path
  }
  set_file_system(
    "/manifest.json",
    write_json([temp, `config.json`], folders),
    READ_ONLY,
    context
  )
  server.start()
}

//const app = express()
//app.use((req, res, next) => {
//  console.log(req.method, req.url, req.headers)
//  res.set("Access-Control-Allow-Origin", "*")
//  res.set("Access-Control-Allow-Methods", "*")
//  res.set("Access-Control-Allow-Headers", "*")
//  res.set("Access-Control-Allow-Credentials", "true")
//  res.set("Access-Control-expose-headers", "*")
//  res.set("Access-Control-request-headers", "*")
//  next()
//})
//app.use(webdav.extensions.express("/", server))
//app.listen(config.port) // Start the Express server
