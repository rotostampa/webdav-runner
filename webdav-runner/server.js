import { v2 as webdav } from "webdav-server"
import express from "express"
import httpproxy from 'http-proxy'


import https from "https"

import {
  ensure_dir,
  expand_path,
  get_config,
  json_dumps,
  json_loads,
  read_file,
  startswith,
  endswith,
  write_json,
} from "../webdav-runner/utils.js"

import fs from "fs"
import { execFile as exec_file } from "child_process"
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
    txt: { platform: process.platform, port: get_config(config, 'webdav', 'port') },
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

  const temp = expand_path([
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
    e.proxy = `https://${proxyprefix}${e.name}${proxydomain}:${e.txt.port}/`
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

  let proxydomain = get_config(config, 'proxy', 'domain')
  if (! startswith(proxydomain, '.')) {
    proxydomain = "." + proxydomain
  }
  const proxyprefix = get_config(config, 'proxy', 'prefix')
  const proxy = httpproxy.createProxyServer({secure: get_config(config, 'proxy', 'secure'), ignorePath: true}); // See (†)

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

    console.log(req.socket.servername, startswith(req.socket.servername, proxyprefix))

    if (endswith(req.socket.servername, proxydomain) && startswith(req.socket.servername, proxyprefix)) {

      const proxyname = req.socket.servername.slice(proxyprefix.length, - proxydomain.length)

      const target = servers[proxyname]


      if (target.name == bonjour.name) {
        console.log('proxy to self, skipping')
      } else if (target) {
        const url = `https://${target.referer.address}:${target.txt.port}${req.path}`
        console.log('forwarding to', url)
        proxy.web(req, res, { target: url }, e => {
          res.status(502)
          res.send({ success: false, status: 502, error: `${e}`, url: url })
        });
        return

      } else {
        res.status(404)
        res.send({ success: false, status: 404, servers: servers })
        return
      }
    }

    next()


    console.log(
      "🤖",
      req.method,
      `${req.socket.servername}${req.path}`,
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
    //console.log(
    //  "sample token",
    //  jwt.sign({ command: "/usr/bin/say", arguments: ["hello"] }, jwt_secret)
    //)

    app.get("/execute/:jwt", (req, res) => {
      let result
      try {
        result = jwt.verify(req.params.jwt, jwt_secret)
      } catch (e) {}

      if (!result) {
        res.status(401)
        res.send({ success: false, status: 401 })
      } else {
        console.log('🚀 running', result.command, ...result.arguments)
        exec_file(
          result.command || "/bin/bash",
          result.arguments || [],
          (error, stdout, stderr) => {

            for (const e of [error, stdout, stderr]) {
              if (e) console.log(e)
            }

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
      console.log("🥷 server listening on port " + settings.port)
    )
}
