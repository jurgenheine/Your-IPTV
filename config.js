var env = process.env.NODE_ENV ? 'production':'local';

var config = {
    addon: 'started',
}

switch (env) {
    //Public server build.
    case 'production':
	config.port = process.env.PORT
        config.local = process.env.NODE_ENV
        break;

    //Local sever build.
    case 'local':
	config.port = 3649
        config.local = "http://127.0.0.1:" + config.port;
        break;
}

module.exports = config;
