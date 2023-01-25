
// code copied from https://github.com/typicode/user-startup


import os from 'os'
export default import(`./platforms/${os.platform()}.js`).then(m => m.default)