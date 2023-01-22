import minimist from "minimist"
import default_config from "../webdav-runner/config.js"
import server from "../webdav-runner/server.js"
import { read_file } from "../webdav-runner/utils.js"

const argv = minimist(process.argv.slice(2))

const subcommands = {
  help: () => {
    console.log(`available commands: ${Object.keys(subcommands)}`)
  },
  server: args => {
    let used_conf = {}

    if (args.config) {
      used_conf = JSON.read(read_file(args.config))
    } else {
      console.log("no configuration provided, using", default_config)
    }

    return server(used_conf)
  },
}

const command = argv._[0]

argv._ = argv._.slice(1)

if (command && subcommands[command]) {
  subcommands[command](argv)
} else {
  subcommands["help"](argv)
}
