import Bonjour from "bonjour"
import { execFile as exec_file } from "child_process"
import express from "express"
import httpproxy from "http-proxy"
import jwt from "jsonwebtoken"
import machine_id from "node-machine-id"
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

const SERVICES = {
    filesystem: (
        { path, mount, permissions },
        { server, users, privilege_manager }
    ) => {
        server.setFileSystem(path, new webdav.PhysicalFileSystem(mount))
        for (const [username, perm] of Object.entries(permissions || {})) {
            privilege_manager.setRights(
                users[username],
                path,
                PERMISSIONS[perm]
            )
        }
    },
}

function bonjour_advertise(config) {
    const settings = {
        name:
            config.bonjour.name || machine_id.machineIdSync({ original: true }),
        type: config.bonjour.type,
        port: config.bonjour.port,
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

    const temp = expand_path(
        config.webdav.storage,
        `${config.http.port}`,
        `${config.bonjour.port}`
    )

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

        settings.mount = ensure_dir(
            settings.mount
                ? settings.mount
                : [temp, settings.path.replace("/", "-")],
            settings.cleanup
        )

        SERVICES[settings.type](settings, context)

        delete settings.cleanup
    }

    const servers = {}

    Bonjour().find({ type: config.bonjour.type }, e => {
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
            "Accept, Authorization, Content-Type, Content-Length, Depth, X-Requested-With"
        )

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
        const protocol = config.http.secure ? "https" : "http"

        console.info(
            "🤖",
            req.method,
            `${protocol}://${req.hostname}:${config.http.port}${req.path}`
        )
    })

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
        })
    })

    if (config.execute.secret) {
        //console.info("sample jwt request")
        //console.info(`curl https://localhost:${settings.port}/execute/${jwt.sign({ command: "npm", arguments: ["install", '-g', 'webdav-runner@latest'] }, jwt_secret)}/ --insecure`)

        app.get("/execute/:jwt", (req, res) => {
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
                console.info("🚀 running", result.command, ...result.arguments)
                exec_file(
                    result.command || "/bin/hostname",
                    result.arguments || [],
                    (error, stdout, stderr) => {
                        res.status(error ? 422 : 200)
                        res.send({
                            success: error ? false : true,
                            status: error ? 422 : 200,
                            error,
                            stdout,
                            stderr,
                        })

                        console.info(
                            "🚀 running complete:",
                            result.command,
                            ...result.arguments
                        )

                        if (error) console.error(error)
                        if (stderr) console.warn(stderr)
                        if (stdout) console.log(stdout)
                    }
                )
            }
        })
    }

    app.use(webdav.extensions.express("/", server))

    return app
}
