import { v2 as webdav } from "webdav-server"
import express from "express"
import https from "https"

import {
  expand_path,
  read_file,
  ensure_dir,
  write_json,
  startswith,
  json_loads,
  json_dumps,
} from "../webdav-runner/utils.js"
import default_config from "../webdav-runner/config.js"

import fs from "fs"
import { execFile } from "node:child_process"
import Bonjour from "bonjour"

import jwt from "jsonwebtoken"
import machine_id from 'node-machine-id';

// var pem = require('pem')
// pem.createCertificate({ days: 1, selfSigned: true }, function (err, keys) {
//   { key: keys.serviceKey, cert: keys.certificate }
// })

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
      if (result && typeof result[key] !== "undefined") {
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
  path,
  mount,
  permission,
  { server, user, privilege_manager }
) {
  console.log("mounting fs", path, mount)
  server.setFileSystem(path, new webdav.PhysicalFileSystem(mount))
  privilege_manager.setRights(user, path, permission)
}

//const filenames = {}
//function execute_file(loc) {
//  const file = expand_path(loc)
//  if (!filenames[file]) {
//    filenames[file] = file
//    execFile("/bin/bash", [file], (error, stdout, stderr) => {
//      if (error) {
//        console.log("error", file, error)
//      }
//      console.log("stdout", file, stdout)
//      console.log("stderr", file, stderr)
//      if (fs.existsSync(file)) {
//        fs.rmSync(file)
//      }
//      delete filenames[file]
//    })
//  }
//}

const services = {
  readwrite: ({ path, mount }, context) => {
    set_file_system(path, mount , READ_WRITE, context)
  },
  read: ({ path, mount  }, context) => {
    set_file_system(path, mount , READ_ONLY, context)
  },
  //commands: ({ name, path }, context) => {
  //  set_file_system(name, path, READ_WRITE, context)
  //  fs.watch(path, (eventType, filename) => {
  //    console.log("changed", eventType, filename)
  //    if (!startswith(filename, ".")) {
  //      execute_file([path, filename])
  //    }
  //  })
  //},
  //bonjour: ({ name, path }, context) => {
  //  set_file_system(`/${name}`, path, READ_ONLY, context)
  //  Bonjour().find(
  //    { type: get_config(context.config, "bonjour", "type") },
  //    e => {
  //      delete e.rawTxt
  //      write_json([path, `${e.name}.json`], e)
  //    }
  //  )
  //},
}

function bonjour_advertise(config) {
  const settings = {
    name: get_config(config, "bonjour", "name") || machine_id.machineIdSync({original:true}),
    type: get_config(config, "bonjour", "type"),
    port: get_config(config, "bonjour", "port"),
    subtypes: [process.platform],
  }

  Bonjour().publish(settings)
}

export default config => {
  bonjour_advertise(config)

  // bonjour.find({ type: get_config(config, 'bonjour', 'type') }, e => console.log('up', e))

  const user_manager = new webdav.SimpleUserManager()
  const user = user_manager.addUser(
    get_config(config, "webdav", "username"),
    get_config(config, "webdav", "password"),
    false
  )

  const privilege_manager = new webdav.SimplePathPrivilegeManager()

  const temp = ensure_dir([
    get_config(config, "storage"),
    `${get_config(config, "webdav", "port")}`,
    `${get_config(config, "bonjour", "port")}`,
  ])

  privilege_manager.setRights(user, "/", READ_ONLY)

  const settings = {
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
  }

  const server = new webdav.WebDAVServer(settings)

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

  for (const settings of folders) {
    if (!settings.type) {
      settings.type = "read"
    }
    if (!settings.tags) {
      settings.tags = [settings.type]
    }

    settings.mount = ensure_dir(
      settings.mount ? settings.mount : [temp, settings.path.replace("/", "-")],
      settings.cleanup
    )

    services[settings.type](settings, context)

    delete settings.path
  }

  const servers = {}

  Bonjour().find({ type: get_config(context.config, "bonjour", "type") }, e => {
    delete e.rawTxt
    servers[e.name] = e
  })

  //set_file_system(
  //  "/manifest.json",
  //  write_json([temp, "config.json"], {
  //    platform: process.platform,
  //    folders: folders,
  //  }),
  //  READ_ONLY,
  //  context
  //)

  const app = express()
  app.get("/manifest", (req, res) => {
    res.send({ platform: process.platform, folders, servers })
  })

  const jwt_secret = get_config(config, "commands", "secret")

  if (jwt_secret) {
    console.log(
      "sample token",
      jwt.sign(
        { command: "/bin/bash", arguments: ["-c", "hostname"] },
        jwt_secret
      )
    )

    app.get("/commands/:jwt", (req, res) => {
      let result
      try {
        result = jwt.verify(req.params.jwt, jwt_secret)
      } catch (e) {}

      if (!result) {
        res.status(401)
        res.send({ ok: false })
      } else {
        execFile(
          result.command || "/bin/bash",
          result.arguments || [],
          (error, stdout, stderr) => {
            if (error) {
              console.log("error", error)
            }
            console.log("stdout", stdout)
            console.log("stderr", stderr)
          }
        )
        res.send({ ok: true, ...result })
      }
    })
  }

  app.use((req, res, next) => {
    for (const [key, value] of Object.entries(settings.headers)) {
      res.set(key, value)
    }
    next()
  })
  app.use(webdav.extensions.express("/", server))

  https.createServer(settings.https, app).listen(settings.port, () => console.log("Express server listening on port " + settings.port))
}
