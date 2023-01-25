import fs from 'fs'
import cp from 'child_process'
import mkdirp from 'mkdirp'
import untildify from 'untildify'

const dir = untildify('~\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup')



function get_file (name) {
  return `${dir}\\${name}.vbs`
}

function add (name, cmd, args = [], out) {
  const file = get_file(name)

  let command = `""${cmd}""`

  if (args.length) {
    const escapedArgs = args.map(a => `""${a}""`).join(' ')
    command += ` ${escapedArgs}`
  }

  if (out) {
    command += ` > ""${out}""`
  }

  const data = `CreateObject("Wscript.Shell").Run "cmd /c ""${command}""", 0, true`

  mkdirp.sync(dir)
  fs.writeFileSync(file, data)
  return file
}

function create (name, cmd, args, out) {
  const file = add(name, cmd, args, out)

  // Spawn vbscript
  cp.spawn('cmd', ['/c', file], {
    stdio: 'ignore',
    detached: true
  }).unref()
}

function remove (name) {
  const file = get_file(name)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export default {
  dir,
  get_file,
  add,
  create,
  remove
}