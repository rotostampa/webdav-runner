import fs from "fs"
import url from "url"
import path from "path"

const homedir =
  process.env[process.platform == "win32" ? "USERPROFILE" : "HOME"]

export const expand_path = loc => {
  if (!loc) return loc

  if (typeof loc !== "string") {
    loc = path.join(...loc)
  }
  if (loc == "~") return homedir
  if (loc.slice(0, 2) == "~/") return path.join(homedir, loc.slice(2))
  if (loc.slice(0, 3) == "../")
    return path.join(path.dirname(url.fileURLToPath(import.meta.url)), loc)
  return loc
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

export const read_file = loc => fs.readFileSync(expand_path(loc)).toString()
export const write_file = (loc, data) => {
  const target = expand_path(loc)
  fs.writeFileSync(target, data)
  return target
}
export const read_json = loc => JSON.loads(read_file(loc))
export const write_json = (loc, data) => write_file(loc, JSON.stringify(data, null, 4))

export const startswith = (str, prefix) => {
  return str && str.indexOf(prefix) === 0
}
