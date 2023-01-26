import { local_path, read_json } from "../webdav-runner/utils.js"

export default read_json(local_path("../package.json"))
