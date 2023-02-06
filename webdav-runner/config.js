import { expand_path, json_loads, read_file } from "../webdav-runner/utils.js"
import fs from "fs"

const default_config = {
    configuration: "~/.webdav-runner/config.json",
    http: {
        secure: true,
        port: 1900,
        key: "~/.webdav-runner/ssl.key",
        cert: "~/.webdav-runner/ssl.cert",
        host: "0.0.0.0",
    },
    webdav: {
        users: {
            admin: "admin",
            user: "user",
        },
        storage: "~/.webdav-runner",
        folders: [
            {
                path: "/",
                mount: "~/Storage",
                type: "filesystem",
                tags: ["session"],
                permissions: {
                    admin: "write",
                    user: "read",
                },
                cleanup: false,
            },
        ],
    },
    bonjour: {
        port: 1923,
        type: "webdav-runner",
        name: null,
    },
    execute: {
        secret: "my-super-secret",
    },
    proxy: {
        domain: "localtest.me",
        prefix: "webdav-",
        secure: false,
        port: null,
    },
    startup: {
        log: "~/.webdav-runner/webdav-runner.log",
        name: "webdav-runner",
    },
}

const traverse_config = (configs, keys) => {
    for (const current of configs) {
        let result = current

        loop: for (const key of keys) {
            if (result && typeof result[key] !== "undefined") {
                result = result[key]
            } else {
                result = undefined
                break loop
            }
        }

        if (result != undefined) {
            return result
        }
    }
}

const dump_config = (...configs) => {
    const getter = (...keys) => traverse_config(configs, keys)
    const result = {}

    for (const [key, values] of Object.entries(default_config)) {
        if (key == "configuration") {
            result[key] = getter(key)
        } else {
            result[key] = {}
            for (const subk of Object.keys(values)) {
                result[key][subk] = getter(key, subk)
            }
        }
    }
    return result
}

export const make_config = cliconf => {
    const file = expand_path(
        cliconf.configuration || default_config.configuration
    )
    const fileconf = fs.existsSync(file) ? json_loads(read_file(file)) : {}

    return dump_config(cliconf, fileconf, default_config)
}
