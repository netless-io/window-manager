const dotenv = require('dotenv').config();

module.exports = {
    envs: dotenv.parsed,
    configureWebpack: {
        module: {
            unknownContextCritical: false
        }
    }
}
