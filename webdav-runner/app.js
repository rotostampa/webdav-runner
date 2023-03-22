import Bonjour from "bonjour"
import { execFile as exec_file } from "child_process"
import express from "express"
import httpproxy from "http-proxy"
import jwt from "jsonwebtoken"
import machine_id from "node-machine-id"
import os from "os"
import { v2 as webdav } from "webdav-server"

import pkg from "../webdav-runner/pkg.js"
import {
    endswith,
    ensure_dir,
    expand_path,
    startswith,
} from "../webdav-runner/utils.js"

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

const get_machine_id = () => machine_id.machineIdSync({ original: true })

const SERVICES = {
    filesystem: (
        { path, mount, permissions, cleanup },
        { server, users, privilege_manager, config }
    ) => {
        const target = ensure_dir(
            ...(mount
                ? [mount]
                : [
                      expand_path(
                          config.webdav.storage,
                          `${config.http.port}`,
                          `${config.bonjour.port}`
                      ),
                      path.replace("/", "-"),
                  ]),
            cleanup
        )

        const pfs = new webdav.PhysicalFileSystem(target)

        server.setFileSystem(path, pfs)
        for (const [username, perm] of Object.entries(permissions || {})) {
            privilege_manager.setRights(
                users[username],
                path,
                PERMISSIONS[perm]
            )
        }

        return target
    },
    temp: ({ path, mount, permissions, cleanup }, extra) =>
        SERVICES.filesystem(
            {
                mount: expand_path(
                    os.tmpdir(),
                    mount || `webdav-runner-${get_machine_id()}`
                ),
                path,
                permissions,
                cleanup,
            },
            extra
        ),
}

function bonjour_advertise(config) {

    if (config.bonjour) return {}

    const name = config.bonjour.name || get_machine_id()

    const settings = {
        name: name,
        type: config.bonjour.type,
        port: config.bonjour.port,
        host: config.bonjour.host || `webdav-${name}.local`,
        txt: {
            platform: process.platform,
            port: config.proxy.port || config.http.port,
            version: pkg.version,
            protocol: config.http.secure ? "https" : "http",
        },
    }

    Bonjour().publish(settings)

    return settings
}

export default config => {
    const bonjour = bonjour_advertise(config)

    console.info("started bonjour using", bonjour)

    const user_manager = new webdav.SimpleUserManager()
    const privilege_manager = new webdav.SimplePathPrivilegeManager()

    const users = {}

    for (const [username, password] of Object.entries(config.webdav.users)) {
        users[username] = user_manager.addUser(username, password, false)
    }

    const server = new webdav.WebDAVServer({
        httpAuthentication: new webdav.HTTPBasicAuthentication(
            user_manager,
            "realm"
        ),
        privilegeManager: privilege_manager,
        withCredentials: true,
        maxRequestDepth: Infinity,
    })

    const context = {
        server,
        users,
        privilege_manager,
        config,
    }

    for (const settings of Object.values(config.webdav.folders)) {
        if (!settings.type) {
            settings.type = "filesystem"
        }
        if (!settings.tags) {
            settings.tags = [settings.type]
        }

        settings.mount = SERVICES[settings.type](settings, context)

        delete settings.cleanup
    }

    const servers = {}

    if (config.bonjour) Bonjour().find({ type: config.bonjour.type }, e => {
        delete e.rawTxt
        servers[e.name] = {
            proxy: `${e.txt.protocol}://${config.proxy.prefix}${e.name}${config.proxy.domain}:${e.txt.port}/`,
            address: e.referer.address,
            ...e.txt,
        }
    })

    const app = express()

    const proxy = httpproxy.createProxyServer({
        secure: config.proxy.secure ? true : false,
        ignorePath: true,
    }) // See (†)

    app.use((req, res, next) => {
        res.set("Access-Control-Allow-Origin", "*")
        res.set(
            "Access-Control-Allow-Methods",
            "HEAD, GET, PUT, PROPFIND, DELETE, OPTIONS, MKCOL, MOVE, COPY"
        )
        res.set(
            "Access-Control-Allow-Headers",
            "Accept, Authorization, Content-Type, Content-Length, Depth, X-Requested-With, Origin, User-Agent, X-Requested-With, Destination"
        )

        next()
        const protocol = config.http.secure ? "https" : "http"

        console.info(
            "🤖",
            req.method,
            `${protocol}://${req.hostname}:${config.http.port}${req.path}`
        )
    })


    if (config.proxy) {


        app.use((req, res, next) => {

            // proxy logic
            if (
                req.hostname &&
                endswith(req.hostname, config.proxy.domain) &&
                startswith(req.hostname, config.proxy.prefix)
            ) {
                const proxyname = req.hostname.slice(
                    config.proxy.prefix.length,
                    -config.proxy.domain.length
                )

                const target = servers[proxyname]

                if (target && proxyname == bonjour.name) {
                    console.info("proxy to self, skipping")
                } else if (target) {
                    const url = `${target.txt.protocol}://${target.address}:${target.port}${req.path}`
                    console.info("forwarding to", url)
                    proxy.web(req, res, { target: url }, e => {
                        res.status(502)
                        res.send({
                            success: false,
                            status: 502,
                            error: `${e}`,
                            url: url,
                        })
                    })
                    return
                } else {
                    res.status(404)
                    res.send({ success: false, status: 404, servers: servers })
                    return
                }
            }
            next()
        })
    }


    app.get("/manifest", (req, res) => {
        res.set("Cache-Control", "max-age=3600")

        res.send({
            success: true,
            status: 200,
            platform: process.platform,
            version: pkg.version,
            name: bonjour.name,
            folders: config.webdav.folders,
            servers,
            capabilities: {
                proxy:   config.proxy ? true : false,
                execute: config.execute ? true : false,
                open:    config.open ? true : false,
            }
        })
    })

    const execute_command = (command, args, res) => {
        console.info("🚀 running", command, ...args)
        exec_file(
            command || "/bin/hostname",
            args || [],
            (error, stdout, stderr) => {
                res.status(error ? 422 : 200)
                res.send({
                    success: error ? false : true,
                    status: error ? 422 : 200,
                    error,
                    stdout,
                    stderr,
                })

                console.info("🚀 running complete:", command, ...args)

                if (error) console.error(error)
                if (stderr) console.warn(stderr)
                if (stdout) console.log(stdout)
            }
        )
    }

    const execute_jwt = (req, res, callback) => {
        let result
        try {
            result = jwt.verify(req.params.jwt, config.execute.secret)
        } catch (e) {
            console.info("invalid jwt", e)
        }

        if (!result) {
            res.status(401)
            res.send({ success: false, status: 401 })
        } else {
            callback(result)
        }
    }

    if (config.execute.secret) {
        //console.info("sample command jwt request")
        //console.info(`curl https://127.0.0.1:${config.http.port}/execute/${jwt.sign({ command: "say", arguments: ["hello"] }, config.execute.secret)}/ --insecure`)

        app.get("/execute/:jwt", (req, res) =>
            execute_jwt(req, res, result =>
                execute_command(result.command, result.arguments, res)
            )
        )
    }

    const open_commands = {
        darwin: '/usr/bin/open',
        linux: 'open',
        win32: 'start'
    }
    const open_command = open_commands[os.platform()]

    if (config.open.secret && open_command) {
        //console.info("sample open jwt request")
        //console.info(`curl https://127.0.0.1:${config.http.port}/open/${jwt.sign({ path: '/' }, config.execute.secret)}/ --insecure`)



        app.get("/open/:jwt", (req, res) =>
            execute_jwt(req, res, result =>
                server.getFileSystem(
                    new webdav.Path(result.path || "/"),
                    (fs, _, sub) =>
                        execute_command(
                            open_command,
                            [fs.getRealPath(sub).realPath],
                            res
                        )
                )
            )
        )
    }

    app.use(webdav.extensions.express("/", server))

    return app
}
