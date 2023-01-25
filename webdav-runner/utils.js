import default_config from "../webdav-runner/config.js"
import fs from "fs"
import path from "path"
import untildify from "untildify"
import url from "url"

export const local_path = loc =>
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), loc)
export const expand_path = loc => {
    if (typeof loc !== "string") {
        loc = path.join(...loc)
    }
    return untildify(loc)
}

export const ensure_dir = (dir, del) => {
    const folder = expand_path(dir)

    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true })
    } else if (del) {
        fs.rmSync(folder, { recursive: true })
        fs.mkdirSync(folder, { recursive: true })
    }
    return folder
}

export const json_loads = s => JSON.parse(s)
export const json_dumps = s => JSON.stringify(s, null, 4)

export const read_file = loc => fs.readFileSync(expand_path(loc)).toString()
export const write_file = (loc, data) => {
    const target = expand_path(loc)
    fs.writeFileSync(target, data)
    return target
}
export const read_json = loc => json_loads(read_file(loc))
export const write_json = (loc, data) => write_file(loc, json_dumps(data))

export const startswith = (str, prefix) => {
    return str && str.indexOf(prefix) === 0
}
export const endswith = (str, suffix) => {
    return str.indexOf(suffix, str.length - suffix.length) !== -1
}

export const get_config = (config, ...args) => {
    for (const current of [config, default_config]) {
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
