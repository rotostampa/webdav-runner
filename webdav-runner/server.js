import { v2 as webdav } from "webdav-server"
import express from "express"
import https from "https"

import {
  ensure_dir,
  expand_path,
  get_config,
  json_dumps,
  json_loads,
  read_file,
  startswith,
  write_json,
} from "../webdav-runner/utils.js"

import fs from "fs"
import { execFile as exect_file } from "child_process"
import Bonjour from "bonjour"

import jwt from "jsonwebtoken"
import machine_id from "node-machine-id"

// var pem = require('pem')
// pem.createCertificate({ days: 1, selfSigned: true }, function (err, keys) {
//   { key: keys.serviceKey, cert: keys.certificate }
// })

const PERMISSIONS = {
  read: [
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
  ],
  write: ["all"],
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

const SERVICES = {
  filesystem: (
    { path, mount, permissions },
    { server, users, privilege_manager }
  ) => {
    server.setFileSystem(path, new webdav.PhysicalFileSystem(mount))
    for (const [username, perm] of Object.entries(permissions || {})) {
      privilege_manager.setRights(users[username], path, PERMISSIONS[perm])
    }
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
    name:
      get_config(config, "bonjour", "name") ||
      machine_id.machineIdSync({ original: true }),
    type: get_config(config, "bonjour", "type"),
    port: get_config(config, "bonjour", "port"),
    txt: { platform: process.platform },
  }

  Bonjour().publish(settings)

  return settings
}

export default config => {
  const bonjour = bonjour_advertise(config)

  console.log("started bonjour using", bonjour)

  // bonjour.find({ type: get_config(config, 'bonjour', 'type') }, e => console.log('up', e))

  const user_manager = new webdav.SimpleUserManager()

  const users = {}

  for (const [username, password] of Object.entries(
    get_config(config, "webdav", "users")
  )) {
    users[username] = user_manager.addUser(username, password, false)
  }

  const privilege_manager = new webdav.SimplePathPrivilegeManager()

  const temp = ensure_dir([
    get_config(config, "storage"),
    `${get_config(config, "webdav", "port")}`,
    `${get_config(config, "bonjour", "port")}`,
  ])

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
    //headers: {
    //  "Access-Control-Allow-Origin": "*",
    //  "Access-Control-Allow-Methods":
    //    "HEAD, GET, PUT, PROPFIND, DELETE, OPTIONS, MKCOL, MOVE, COPY",
    //  "Access-Control-Allow-Headers":
    //    "Accept, Authorization, Content-Type, Content-Length, Depth",
    //},
  }

  const server = new webdav.WebDAVServer(settings)


  const folders = get_config(config, "webdav", "folders")
  const context = {
    server,
    users,
    privilege_manager,
    config,
  }

  for (const settings of folders) {
    if (!settings.type) {
      settings.type = "filesystem"
    }
    if (!settings.tags) {
      settings.tags = [settings.type]
    }

    settings.mount = ensure_dir(
      settings.mount ? settings.mount : [temp, settings.path.replace("/", "-")],
      settings.cleanup
    )

    SERVICES[settings.type](settings, context)

    delete settings.cleanup
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

  app.use((req, res, next) => {





    res.set("Access-Control-Allow-Origin", "*")
    res.set(
      "Access-Control-Allow-Methods",
      "HEAD, GET, PUT, PROPFIND, DELETE, OPTIONS, MKCOL, MOVE, COPY"
    )
    res.set(
      "Access-Control-Allow-Headers",
      "Accept, Authorization, Content-Type, Content-Length, Depth"
    )
    next()


    console.log(
      req.method,
      req.path,
      "→",
      res.statusCode,
    )

  })

  app.get("/manifest", (req, res) => {
    res.send({
      success: true,
      status: 200,
      platform: process.platform,
      name: bonjour.name,
      folders,
      servers,
    })
  })

  const jwt_secret = get_config(config, "execute", "secret")

  if (jwt_secret) {
    console.log(
      "sample token",
      jwt.sign({ command: "/usr/bin/say", arguments: ["hello"] }, jwt_secret)
    )

    app.get("/execute/:jwt", (req, res) => {
      let result
      try {
        result = jwt.verify(req.params.jwt, jwt_secret)
      } catch (e) {}

      if (!result) {
        res.status(401)
        res.send({ success: false, status: 401 })
      } else {
        exect_file(
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
        res.send({ success: true, status: 200, ...result })
      }
    })
  }

  app.use(webdav.extensions.express("/", server))

  https
    .createServer(settings.https, app)
    .listen(settings.port, () =>
      console.log("Express server listening on port " + settings.port)
    )
}
