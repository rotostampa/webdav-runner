import minimist from "minimist"
import default_config from "../webdav-runner/config.js"
import server from "../webdav-runner/server.js"
import {
    read_file,
    get_config,
    json_loads,
    ensure_dir,
    expand_path,
    write_json,
} from "../webdav-runner/utils.js"
import fs from "fs"
import path from "path"
import { ensure_certs } from "../webdav-runner/certs.js"
import { execFile as exec_file } from "child_process"

const default_config_location = expand_path([
    get_config({}, "storage"),
    "config.json",
])

const load_config = args => {
    if (args.config) {
        console.log("load custom config in ", args.config)
        return json_loads(read_file(args.config))
    } else if (fs.existsSync(default_config_location)) {
        console.log("load default config in ", default_config_location)
        return json_loads(read_file(default_config_location))
    } else {
        console.log("no config found")
        return null
    }
}

const argv = minimist(process.argv.slice(2))

const subcommands = {
    help: async args =>
        console.log(`available commands: ${Object.keys(subcommands)}`),
    server: async args => await server(load_config(args)),
    setup: async args => {
        let used_conf = load_config(args)
        if (!used_conf) {
            console.log("creating conf under", default_config_location)

            used_conf = { ...default_config }
            used_conf["webdav"]["ssl_key"] = path.join(
                used_conf["storage"],
                "certificate.key"
            )
            used_conf["webdav"]["ssl_cert"] = path.join(
                used_conf["storage"],
                "certificate.cert"
            )

            ensure_dir(used_conf["storage"])

            write_json(default_config_location, used_conf)
        }

        const { cert } = await ensure_certs(used_conf)

        // security add-trusted-cert certs/self-signed.cert.pem

        if (process.platform == "darwin") {
            exec_file("/usr/bin/security", [
                "add-trusted-cert",
                expand_path(cert),
            ])
        }
    },
}

const command = argv._[0]

argv._ = argv._.slice(1)

if (command && subcommands[command]) {
    subcommands[command](argv)
} else {
    subcommands["help"](argv)
}
