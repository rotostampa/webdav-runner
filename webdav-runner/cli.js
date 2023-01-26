import startup from "../startup/startup.js"
import { renew_certs, find_existing_certs } from "../webdav-runner/certs.js"
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
import os from "os"
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

const dump_current_config = config => {
    const result = {}
    for (const [key, values] of Object.entries(default_config)) {
        if (key == 'configuration') {
            result[key] = config(key)
        } else {
            result[key] = {}
            for (const subk of Object.keys(values)) {
                result[key][subk] = config(key, subk)
            }
        }
    }
    return result
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
            write_json(localconfig, dump_current_config(config))
        }
    },
    renew_certs: async config => await renew_certs(config),

    accept_certs: async config => {
        const cert = config("certificates", 'cert')

        if (cert) {

            if (! fs.existsSync(expand_path(cert))) {
                console.error('non existing cert: ', cert)
                process.exit(1)
            }

            console.log('accepting cert', expand_path(cert))

            if (process.platform == "darwin") {
                exec_file("/usr/bin/security", [
                    "add-trusted-cert",
                    expand_path(cert),
                ])
            } else {
                console.error('not implemented for platform:', os.platform())
            }
        }


    },

    startup: async config => {
        const process_exe = process.execPath
        const process_args = [
            process.argv[1],
            "server",
            ...process.argv.slice(3),
        ]

        //const process_exe = 'npm'
        //const process_args = [
        //    'exec', '--y', 'webdav-runner@latest',
        //    "server",
        //    ...process.argv.slice(3),
        //]

        const library = await startup

        console.info("registering at startup", process_exe, ...process_args)

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
