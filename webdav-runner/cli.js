import { execFile as exec_file } from "child_process"
import fs from "fs"
import minimist from "minimist"
import os from "os"
import path from "path"

import startup from "../startup/startup.js"
import { renew_certs } from "../webdav-runner/certs.js"
import make_config from "../webdav-runner/config.js"
import server from "../webdav-runner/server.js"
import { ensure_dir, expand_path, write_json } from "../webdav-runner/utils.js"

const subcommands = {
    help: async () =>
        console.info(`available commands: ${Object.keys(subcommands)}`),
    server: async config => await server(config),
    setup: async config => {
        const file = expand_path(config.configuration)
        console.info("creating conf:", config)
        ensure_dir(path.dirname(file))
        write_json(file, config)
    },
    renew_certs: async config => await renew_certs(config),
    accept_certs: async config => {
        const cert = config.http.cert

        if (cert) {
            if (!fs.existsSync(expand_path(cert))) {
                console.error("non existing cert: ", cert)
                process.exit(1)
            }

            console.log("accepting cert", expand_path(cert))

            if (process.platform == "darwin") {
                exec_file("/usr/bin/security", [
                    "add-trusted-cert",
                    expand_path(cert),
                ])
            } else {
                console.error("not implemented for platform:", os.platform())
            }
        }
    },
    startup: async config => {
        console.log(config)

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

        library.remove(config.startup.name)
        library.create(
            config.startup.name, // id
            process_exe, // cmd
            process_args,
            expand_path(config.startup.log)
        )
    },
    startdown: async config => {
        const library = await startup
        library.remove(config.startup.name)
    },
}

export default argv => {
    const parsed = minimist(argv)

    const command = parsed._[0]

    if (parsed._.length > 1) {
        console.error(
            "no positional arguments are allowed: ",
            ...parsed._.slice(1)
        )
    } else {
        delete parsed._
    }

    if (command && subcommands[command]) {
        subcommands[command](make_config(parsed))
    } else {
        subcommands["help"](make_config(parsed))
    }
}
