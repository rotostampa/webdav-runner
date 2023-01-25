import startup from "../startup/startup.js"
import { ensure_certs } from "../webdav-runner/certs.js"
import default_config from "../webdav-runner/config.js"
import server from "../webdav-runner/server.js"
import {
    read_file,
    json_loads,
    ensure_dir,
    expand_path,
    write_json,
} from "../webdav-runner/utils.js"
import { execFile as exec_file } from "child_process"
import fs from "fs"
import minimist from "minimist"
import path from "path"

const traverse_config = (configs, ...args) => {
    for (const current of configs) {
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

const make_config = cliconf => {
    const file = expand_path(
        cliconf.configuration || default_config.configuration
    )
    let fileconf = {}

    if (fs.existsSync(file)) {
        fileconf = json_loads(read_file(file))
    }
    return (...args) =>
        traverse_config([cliconf, fileconf, default_config], ...args)
}

const argv = minimist(process.argv.slice(2))

const subcommands = {
    help: async () =>
        console.info(`available commands: ${Object.keys(subcommands)}`),
    server: async config => await server(config),
    setup: async config => {
        const localconfig = expand_path(config("configuration"))

        if (!fs.existsSync(localconfig)) {
            console.info("creating conf under", localconfig)
            ensure_dir(path.dirname(localconfig))
            write_json(localconfig, default_config)
        }
    },
    certificates: async config => {
        const { cert } = await ensure_certs(config, true)

        if (process.platform == "darwin") {
            exec_file("/usr/bin/security", [
                "add-trusted-cert",
                expand_path(cert),
            ])
        }
    },
    startup: async config => {
        const process_exe = process.execPath
        const process_args = [
            process.argv[1],
            "server",
            ...process.argv.slice(3),
        ]

        const library = await startup

        library.remove(config("startup", "name"))
        library.create(
            config("startup", "name"), // id
            process_exe, // cmd
            process_args,
            expand_path(config("startup", "log"))
        )
    },
    startdown: async config => {
        const library = await startup
        library.remove(config("startup", "name"))
    },
}

const command = argv._[0]

if (argv._.length > 1) {
    console.error("no positional arguments are allowed: ", ...argv._.slice(1))
} else {
    delete argv._
}

if (command && subcommands[command]) {
    subcommands[command](make_config(argv))
} else {
    subcommands["help"](make_config(argv))
}
